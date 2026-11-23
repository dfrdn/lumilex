'use client';

import { toast } from 'sonner';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, GripVertical, AlertTriangle, CheckCircle2, Paperclip, Upload } from 'lucide-react';
import type { Corporation, CorporationPerson, CorporationPersonRole, CorporationFile } from '@/types/corporations';
import { applySavedPerson, dedupePeople, personIdClusters } from '@/lib/corporation-identity';
import { parseAmount } from '@/lib/parse-amount';
import { uploadCorporationFile } from '@/lib/corporations/upload-file';

interface Props {
  corporation: Corporation;
  people: CorporationPerson[];
  files?: CorporationFile[];
  onCorporationChange?: (corporation: Corporation) => void;
  onPeopleChange: React.Dispatch<React.SetStateAction<CorporationPerson[]>>;
  onFilesChange: React.Dispatch<React.SetStateAction<CorporationFile[]>>;
}

// Local edit shape for a draft person row in the intake form. ID is null
// until first save; once we have an ID we PATCH instead of POST.
interface DraftPerson {
  localKey: string;
  id: number | null;
  role: CorporationPersonRole;
  // Natural vs juridical. Only meaningful for Incorporator/Stockholder rows;
  // officer/director slots are forced natural elsewhere.
  isJuridical: boolean;
  firstName: string;
  lastName: string;
  nationality: string;
  gender: string;
  residentialAddress: string;
  tin: string;
  passportNumber: string;
  esapNo: string;
  // Juridical-only fields.
  entityName: string;
  entityType: string;
  entityRegistrationNo: string;
  representativeName: string;
  representativeTitle: string;
  sharesSubscribedAmount: string;
  sharesPaidAmount: string;
  alsoDirector: boolean;
  alsoDirectorRowId: number | null; // the "Director" mirror row, if any
}

function rolePerson(p: CorporationPerson): DraftPerson {
  return {
    localKey: `db-${p.id}`,
    id: p.id,
    role: p.role,
    isJuridical: p.isJuridical,
    firstName: p.firstName,
    lastName: p.lastName,
    nationality: p.nationality ?? '',
    gender: p.gender ?? '',
    residentialAddress: p.residentialAddress ?? '',
    tin: p.tin ?? '',
    passportNumber: p.passportNumber ?? '',
    esapNo: p.esapNo ?? '',
    entityName: p.entityName ?? '',
    entityType: p.entityType ?? '',
    entityRegistrationNo: p.entityRegistrationNo ?? '',
    representativeName: p.representativeName ?? '',
    representativeTitle: p.representativeTitle ?? '',
    sharesSubscribedAmount: p.sharesSubscribedAmount?.toString() ?? '',
    sharesPaidAmount: p.sharesPaidAmount?.toString() ?? '',
    alsoDirector: false,
    alsoDirectorRowId: null,
  };
}

function blankNaturalDraft(role: CorporationPersonRole, localKey: string): DraftPerson {
  return {
    localKey,
    id: null,
    role,
    isJuridical: false,
    firstName: '', lastName: '', nationality: '', gender: '',
    residentialAddress: '', tin: '', passportNumber: '', esapNo: '',
    entityName: '', entityType: '', entityRegistrationNo: '',
    representativeName: '', representativeTitle: '',
    sharesSubscribedAmount: '', sharesPaidAmount: '',
    alsoDirector: false, alsoDirectorRowId: null,
  };
}

function blankIncorporator(localKey: string): DraftPerson {
  return blankNaturalDraft('Incorporator', localKey);
}

export default function CorporationIntakeTab({
  corporation,
  people,
  files = [],
  onCorporationChange,
  onPeopleChange: setPeople,
  onFilesChange: setFiles,
}: Props) {
  const id = corporation.id;
  const [corpStatus, setCorpStatus] = useState(corporation.status);
  void corpStatus; // surfaced to UI elsewhere via re-render trigger

  // Push a saved person row up into the shared people state so edits survive
  // tab remounts and stay in sync with the People tab.
  // Autosave runs on every blur, and a new row has no id until its POST
  // returns — a second blur in that window used to POST again and leave a
  // twin. Each row key gets one create; a save that arrives while it is in
  // flight (or before the new id reaches state) waits for it and PATCHes.
  const creates = useRef(new Map<string, Promise<CorporationPerson | null>>());

  async function savePerson(
    key: string,
    rowId: number | null,
    payload: object,
  ): Promise<{ ok: boolean; person: CorporationPerson | null }> {
    let target = rowId;
    if (!target) {
      const pending = creates.current.get(key);
      if (pending) target = (await pending)?.id ?? null;
    }
    if (target) {
      const res = await fetch(`/api/corporation/${id}/people/${target}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && data.error) toast.error(data.error);
      return { ok: res.ok, person: res.ok ? (data.person ?? null) : null };
    }
    const create = fetch(`/api/corporation/${id}/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Could not save this person.');
        return null;
      }
      return (data.person as CorporationPerson | undefined) ?? null;
    });
    creates.current.set(key, create);
    const person = await create;
    if (!person) creates.current.delete(key);
    return { ok: !!person, person };
  }

  function applyPersonSave(saved: CorporationPerson | null | undefined) {
    if (!saved) return;
    setPeople((prev) => applySavedPerson(prev, saved));
  }

  function applyPersonDelete(personId: number) {
    setPeople((prev) => prev.filter((p) => p.id !== personId));
  }

  /** Role id → the ids of every role the same person holds. */
  const personClusters = useMemo(() => personIdClusters(people), [people]);

  /** Files attached to any person row representing the same human as personId. */
  function filesForPerson(personId: number | null): CorporationFile[] {
    if (personId == null) return [];
    const cluster = personClusters.get(personId) ?? [personId];
    return files.filter((f) => f.personId != null && cluster.includes(f.personId));
  }

  // Corporation-level field state
  const [corp, setCorp] = useState({
    proposedNames: corporation.proposedNames.length ? corporation.proposedNames : [''],
    primaryPurpose: corporation.primaryPurpose ?? '',
    principalOfficeAddress: corporation.principalOfficeAddress ?? '',
    authorizedCapitalStock: corporation.authorizedCapitalStock?.toString() ?? '',
    parValue: corporation.parValue?.toString() ?? '',
    officialEmail: corporation.officialEmail ?? '',
    alternateEmail: corporation.alternateEmail ?? '',
    officialMobile: corporation.officialMobile ?? '',
    alternateMobile: corporation.alternateMobile ?? '',
    website: corporation.website ?? '',
    contactFirstName: corporation.contactFirstName ?? '',
    contactLastName: corporation.contactLastName ?? '',
    contactNationality: corporation.contactNationality ?? '',
    contactGender: corporation.contactGender ?? '',
    contactTin: corporation.contactTin ?? '',
    contactPassportNumber: corporation.contactPassportNumber ?? '',
    companyType: corporation.companyType ?? '',
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Incorporators
  const initialIncorporators = useMemo(() => {
    const incorps = people.filter((p) => p.role === 'Incorporator');
    if (incorps.length === 0) {
      return [blankIncorporator('new-1')];
    }
    // For each incorporator, see if a director row exists for the same name.
    // Juridical incorporators are never mirrored as directors (directors must
    // be natural persons under RCC §22), so skip the lookup entirely for them.
    return incorps.map((p): DraftPerson => {
      const dir = p.isJuridical
        ? undefined
        : people.find(
            (o) => o.role === 'Director' && o.firstName === p.firstName && o.lastName === p.lastName,
          );
      return {
        ...rolePerson(p),
        alsoDirector: !!dir,
        alsoDirectorRowId: dir?.id ?? null,
      };
    });
  }, [people]);

  const [incorporators, setIncorporators] = useState<DraftPerson[]>(initialIncorporators);

  // Officers (one row per slot: President, Treasurer, Corporate Secretary).
  // Officers must be natural persons; the slot draft is initialised with
  // isJuridical=false and no UI exists to flip it.
  const officerSlots: CorporationPersonRole[] = ['President', 'Treasurer', 'Corporate Secretary'];
  const initialOfficers = useMemo(() => {
    const map: Partial<Record<CorporationPersonRole, DraftPerson>> = {};
    for (const slot of officerSlots) {
      const found = people.find((p) => p.role === slot);
      map[slot] = found ? rolePerson(found) : blankNaturalDraft(slot, `new-officer-${slot}`);
    }
    return map as Record<CorporationPersonRole, DraftPerson>;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);
  const [officers, setOfficers] = useState<Record<CorporationPersonRole, DraftPerson>>(initialOfficers);

  // Nominees (OPC)
  const initialNominee = useMemo(() => {
    const n = people.find((p) => p.role === 'Nominee');
    return n ? rolePerson(n) : null;
  }, [people]);
  const initialAltNominee = useMemo(() => {
    const n = people.find((p) => p.role === 'Alternate Nominee');
    return n ? rolePerson(n) : null;
  }, [people]);
  const [nominee, setNominee] = useState<DraftPerson | null>(initialNominee);
  const [altNominee, setAltNominee] = useState<DraftPerson | null>(initialAltNominee);

  // ---- OPC mode detection ----
  // Only count incorporator rows that have an actual name. The intake form
  // seeds one empty draft row so the user has something to type into; we
  // must not treat that as "1 incorporator = OPC" before the user has
  // committed any data. A row is "named" if it has either a natural-person
  // name OR (for juridical entities) an entity name.
  const namedIncorporators = incorporators.filter((p) =>
    p.isJuridical ? p.entityName.trim() : (p.firstName.trim() || p.lastName.trim()),
  );
  const namedIncorporatorCount = namedIncorporators.length;
  // OPCs require a single natural-person shareholder. A sole juridical
  // incorporator must not trigger the OPC auto-stamp.
  const soleNaturalIncorporator = namedIncorporatorCount === 1 && !namedIncorporators[0].isJuridical;

  // OPC is the stored type OR the inferred type from a sole NATURAL-PERSON
  // incorporator when no type has been chosen yet. Never let a transient
  // single empty row, or a juridical sole incorporator, flip the inference on.
  const isOpc = corp.companyType === 'OPC' || (corp.companyType === '' && soleNaturalIncorporator);

  // Auto-detection may only write to the DB in response to an actual
  // incorporator edit in this session — opening the tab must never PATCH.
  // A type the user picked manually (or one loaded from the DB) is never
  // auto-cleared; only a type this session auto-stamped can be.
  const userEditedIncorporators = useRef(false);
  const autoStampedOpc = useRef(false);

  useEffect(() => {
    // Auto-suggest OPC: ONLY when (a) there is exactly one named incorporator
    // who is a natural person and (b) the user has not chosen a company type.
    // Once they grow past one incorporator (or the sole one becomes juridical),
    // clear the stamp so it doesn't lie about the corp.
    if (userEditedIncorporators.current) {
      if (soleNaturalIncorporator && corp.companyType === '') {
        autoStampedOpc.current = true;
        setCorp((c) => ({ ...c, companyType: 'OPC' }));
        void saveCorpField('companyType', 'OPC');
      } else if (
        !soleNaturalIncorporator &&
        corp.companyType === 'OPC' &&
        autoStampedOpc.current &&
        namedIncorporatorCount !== 0
      ) {
        autoStampedOpc.current = false;
        setCorp((c) => ({ ...c, companyType: '' }));
        void saveCorpField('companyType', null);
      }
    }

    if (isOpc && incorporators.length === 1 && !incorporators[0].isJuridical) {
      setIncorporators((xs) =>
        xs.map((x, i) => (i === 0 && !x.alsoDirector ? { ...x, alsoDirector: true } : x)),
      );
    }
    if (!isOpc) {
      setNominee(null);
      setAltNominee(null);
    } else {
      if (!nominee) setNominee(emptyDraft('Nominee'));
      if (!altNominee) setAltNominee(emptyDraft('Alternate Nominee'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namedIncorporatorCount, soleNaturalIncorporator, corp.companyType]);

  function emptyDraft(role: CorporationPersonRole): DraftPerson {
    return blankNaturalDraft(role, `new-${role}-${Date.now()}`);
  }

  async function saveCorpField(key: keyof typeof corp, value: unknown): Promise<boolean> {
    setSaveStatus('saving');
    const payload: Record<string, unknown> = {};
    if (key === 'authorizedCapitalStock' || key === 'parValue') {
      payload[key] = parseAmount(value as string);
    } else if (key === 'proposedNames') {
      payload[key] = value;
    } else if (key === 'companyType') {
      payload[key] = value === '' ? null : value;
    } else {
      payload[key] = value;
    }
    try {
      const res = await fetch(`/api/corporation/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setSaveStatus('error');
        return false;
      }
      const data = await res.json().catch(() => ({}));
      if (data.corporation) onCorporationChange?.(data.corporation);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
      return true;
    } catch {
      setSaveStatus('error');
      return false;
    }
  }

  // What each field last saved as. Leaving a field you didn't change — tabbing
  // through, or "Fill in" moving the cursor along — mustn't write the same
  // value back, stamp the company as updated and add an audit entry.
  const savedCorp = useRef(corp);

  function onCorpBlur(key: keyof typeof corp) {
    return () => {
      const value = (corp as Record<string, unknown>)[key];
      if (JSON.stringify(value) === JSON.stringify((savedCorp.current as Record<string, unknown>)[key])) return;
      void saveCorpField(key, value).then((ok) => {
        if (ok) savedCorp.current = { ...savedCorp.current, [key]: value };
      });
    };
  }

  // ---- Incorporator handlers ----

  function updateIncorporator(idx: number, patch: Partial<DraftPerson>) {
    userEditedIncorporators.current = true;
    setIncorporators((xs) => xs.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  function addIncorporator() {
    if (incorporators.length >= 15) return;
    userEditedIncorporators.current = true;
    setIncorporators((xs) => [...xs, blankIncorporator(`new-${Date.now()}`)]);
  }

  async function removeIncorporator(idx: number) {
    userEditedIncorporators.current = true;
    const target = incorporators[idx];
    if (target) {
      creates.current.delete(target.localKey);
      creates.current.delete(`${target.localKey}:director`);
    }
    if (target?.id) {
      await fetch(`/api/corporation/${id}/people/${target.id}`, { method: 'DELETE' });
      applyPersonDelete(target.id);
      if (target.alsoDirectorRowId) {
        await fetch(`/api/corporation/${id}/people/${target.alsoDirectorRowId}`, { method: 'DELETE' });
        applyPersonDelete(target.alsoDirectorRowId);
      }
    }
    setIncorporators((xs) => xs.filter((_, i) => i !== idx));
  }

  // `override` carries the freshly-edited row for call sites that save in the
  // same event handler that set state — reading `incorporators[idx]` there
  // would see the pre-update value from the render closure.
  async function saveIncorporator(idx: number, override?: DraftPerson) {
    const p = override ?? incorporators[idx];
    if (!p) return;
    const payload = {
      role: 'Incorporator' as const,
      isJuridical: p.isJuridical,
      // Natural-person fields. Cleared for juridical so we don't carry stale
      // data forward when the user flips a row from natural → juridical.
      firstName: p.isJuridical ? '' : p.firstName,
      lastName: p.isJuridical ? '' : p.lastName,
      gender: p.isJuridical ? null : (p.gender || null),
      passportNumber: p.isJuridical ? null : (p.passportNumber || null),
      esapNo: p.isJuridical ? null : (p.esapNo || null),
      // Shared fields (apply to both).
      nationality: p.nationality || null,
      residentialAddress: p.residentialAddress || null,
      tin: p.tin || null,
      // Juridical-only.
      entityName: p.isJuridical ? (p.entityName || null) : null,
      entityType: p.isJuridical ? (p.entityType || null) : null,
      entityRegistrationNo: p.isJuridical ? (p.entityRegistrationNo || null) : null,
      representativeName: p.isJuridical ? (p.representativeName || null) : null,
      representativeTitle: p.isJuridical ? (p.representativeTitle || null) : null,
      sharesSubscribedAmount: parseAmount(p.sharesSubscribedAmount),
      sharesPaidAmount: parseAmount(p.sharesPaidAmount),
      sortOrder: idx,
    };
    const hasName = p.isJuridical ? !!p.entityName.trim() : !!(p.firstName.trim() || p.lastName.trim());
    if (p.id || hasName) {
      const saved = await savePerson(p.localKey, p.id, payload);
      if (!saved.ok) {
        setSaveStatus('error');
        return;
      }
      if (!p.id) updateIncorporator(idx, { id: saved.person?.id ?? null });
      applyPersonSave(saved.person);
    }

    // Mirror to Director row if "Also a Director" is checked — natural persons
    // only. RCC §22 prohibits juridical directors, so this branch is skipped
    // and any prior mirror is torn down when a row flips to juridical.
    if (p.alsoDirector && !p.isJuridical) {
      const dirPayload = { ...payload, role: 'Director' as const };
      if (p.alsoDirectorRowId || p.firstName.trim() || p.lastName.trim()) {
        const saved = await savePerson(`${p.localKey}:director`, p.alsoDirectorRowId, dirPayload);
        if (!saved.ok) {
          setSaveStatus('error');
          return;
        }
        if (!p.alsoDirectorRowId) updateIncorporator(idx, { alsoDirectorRowId: saved.person?.id ?? null });
        applyPersonSave(saved.person);
      }
    } else if (p.alsoDirectorRowId) {
      // Tear down the mirror when alsoDirector is unchecked OR when the row
      // becomes juridical.
      await fetch(`/api/corporation/${id}/people/${p.alsoDirectorRowId}`, { method: 'DELETE' });
      creates.current.delete(`${p.localKey}:director`);
      applyPersonDelete(p.alsoDirectorRowId);
      updateIncorporator(idx, { alsoDirectorRowId: null, alsoDirector: p.isJuridical ? false : p.alsoDirector });
    }
  }

  // ---- Officer handlers ----

  function updateOfficer(slot: CorporationPersonRole, patch: Partial<DraftPerson>) {
    setOfficers((o) => ({ ...o, [slot]: { ...o[slot], ...patch } }));
  }

  async function saveOfficer(slot: CorporationPersonRole) {
    const p = officers[slot];
    const payload = {
      role: slot,
      firstName: p.firstName,
      lastName: p.lastName,
      nationality: p.nationality || null,
      gender: p.gender || null,
      residentialAddress: p.residentialAddress || null,
      tin: p.tin || null,
      passportNumber: p.passportNumber || null,
      esapNo: p.esapNo || null,
    };
    if (p.id || p.firstName.trim() || p.lastName.trim()) {
      const saved = await savePerson(`officer:${slot}`, p.id, payload);
      if (!p.id && saved.person) updateOfficer(slot, { id: saved.person.id });
      applyPersonSave(saved.person);
    }
  }

  /**
   * Mirror an existing person's identity onto the officer slot. The picker
   * dedupes existing persons by strongest identifier first (passport → TIN →
   * ESAP) to avoid collapsing two people who share a name but are clearly
   * different. The officer row keeps its own DB id (it's a separate
   * corporation_persons row) but mirrors the picked person's identity fields.
   */
  async function mirrorOfficer(slot: CorporationPersonRole, source: CorporationPerson) {
    const current = officers[slot];
    const mirrored: DraftPerson = {
      ...current,
      firstName: source.firstName,
      lastName: source.lastName,
      nationality: source.nationality ?? '',
      gender: source.gender ?? '',
      residentialAddress: source.residentialAddress ?? '',
      tin: source.tin ?? '',
      passportNumber: source.passportNumber ?? '',
      esapNo: source.esapNo ?? '',
    };
    setOfficers((o) => ({ ...o, [slot]: mirrored }));

    // Persist using the freshly-mirrored values directly (don't rely on state
    // being flushed before the fetch).
    const payload = {
      role: slot,
      firstName: mirrored.firstName,
      lastName: mirrored.lastName,
      nationality: mirrored.nationality || null,
      gender: mirrored.gender || null,
      residentialAddress: mirrored.residentialAddress || null,
      tin: mirrored.tin || null,
      passportNumber: mirrored.passportNumber || null,
      esapNo: mirrored.esapNo || null,
    };
    const saved = await savePerson(`officer:${slot}`, mirrored.id, payload);
    if (!mirrored.id && saved.person) updateOfficer(slot, { id: saved.person.id });
    applyPersonSave(saved.person);
  }

  // ---- Nominee handlers ----

  function updateNominee(setter: typeof setNominee, patch: Partial<DraftPerson>) {
    setter((p) => (p ? { ...p, ...patch } : p));
  }

  async function saveNominee(role: 'Nominee' | 'Alternate Nominee', state: DraftPerson | null, setter: typeof setNominee) {
    if (!state) return;
    const payload = {
      role,
      firstName: state.firstName,
      lastName: state.lastName,
      nationality: state.nationality || null,
      residentialAddress: state.residentialAddress || null,
      tin: state.tin || null,
      passportNumber: state.passportNumber || null,
    };
    if (state.id || state.firstName.trim() || state.lastName.trim()) {
      const saved = await savePerson(`nominee:${role}`, state.id, payload);
      if (!state.id && saved.person) {
        const newId = saved.person.id;
        setter((p) => (p ? { ...p, id: newId } : p));
      }
      applyPersonSave(saved.person);
    }
  }

  // ---- Validation ----

  const totalSubscribed = incorporators.reduce((sum, p) => sum + (parseAmount(p.sharesSubscribedAmount) ?? 0), 0);
  const totalPaid = incorporators.reduce((sum, p) => sum + (parseAmount(p.sharesPaidAmount) ?? 0), 0);

  // An incorporator row is considered "filled" when it has the appropriate
  // primary identifier: entity name for juridical, first/last name otherwise.
  function incorporatorHasName(p: DraftPerson) {
    return p.isJuridical ? !!p.entityName.trim() : !!(p.firstName.trim() || p.lastName.trim());
  }
  const incorporatorCount = incorporators.filter(incorporatorHasName).length;
  const countOk = incorporatorCount >= 1 && incorporatorCount <= 15;

  // OPC-specific: secretary cannot equal sole shareholder.
  const opcSecretaryConflict =
    isOpc &&
    incorporators[0] &&
    officers['Corporate Secretary'] &&
    officers['Corporate Secretary'].firstName.trim() &&
    officers['Corporate Secretary'].lastName.trim() &&
    incorporators[0].firstName.trim().toLowerCase() === officers['Corporate Secretary'].firstName.trim().toLowerCase() &&
    incorporators[0].lastName.trim().toLowerCase() === officers['Corporate Secretary'].lastName.trim().toLowerCase();

  // Non-Stock corporations and partnerships have no capital stock; only
  // stock-type corps (Stock, OPC, or not-yet-typed) require the capital fields.
  const requiresCapital = corp.companyType !== 'Non-Stock' && corp.companyType !== 'Partnership';

  const readyToFile =
    countOk &&
    corp.proposedNames.filter(Boolean).length >= 1 &&
    corp.primaryPurpose.trim().length > 0 &&
    corp.principalOfficeAddress.trim().length > 0 &&
    (!requiresCapital ||
      (corp.authorizedCapitalStock.trim().length > 0 && corp.parValue.trim().length > 0)) &&
    corp.officialEmail.trim().length > 0 &&
    corp.contactFirstName.trim().length > 0 &&
    corp.contactLastName.trim().length > 0 &&
    incorporators.every(incorporatorHasName) &&
    officers['Treasurer'].firstName.trim() &&
    officers['Corporate Secretary'].firstName.trim() &&
    (isOpc || officers['President'].firstName.trim()) &&
    !opcSecretaryConflict &&
    (!isOpc || (!!nominee?.firstName.trim() && !!altNominee?.firstName.trim()));

  const [markReadyError, setMarkReadyError] = useState(false);

  async function markReady() {
    setMarkReadyError(false);
    try {
      const res = await fetch(`/api/corporation/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'In SEC' }),
      });
      if (!res.ok) {
        setMarkReadyError(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.corporation) onCorporationChange?.(data.corporation);
      setCorpStatus('In SEC');
    } catch {
      setMarkReadyError(true);
    }
  }

  return (
    <div className="space-y-6">
      {/* Save indicator */}
      <div className="flex justify-end text-xs">
        {saveStatus === 'saving' && <span className="text-stone-500 dark:text-stone-400">Saving…</span>}
        {saveStatus === 'saved' && <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Saved</span>}
        {saveStatus === 'error' && <span className="text-rose-600 dark:text-rose-400">Save failed</span>}
      </div>

      {/* Section 1: Corporate Information */}
      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-4">1. Corporate Information</h3>
        <div className="space-y-4">
          <div data-field="companyType">
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Company Type</label>
            <select
              value={corp.companyType}
              onChange={(e) => {
                const v = e.target.value;
                autoStampedOpc.current = false;
                setCorp((c) => ({ ...c, companyType: v }));
                void saveCorpField('companyType', v);
              }}
              className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600 bg-white dark:bg-card"
            >
              <option value="">— Auto-detect from incorporators —</option>
              <option value="Stock">Stock</option>
              <option value="Non-Stock">Non-Stock</option>
              <option value="OPC">One-Person Corporation (OPC)</option>
              <option value="Partnership">Partnership</option>
            </select>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {corp.companyType === ''
                ? namedIncorporatorCount === 1
                  ? 'A single named incorporator auto-suggests OPC. Pick a type explicitly to override.'
                  : 'Pick a type, or it will default once incorporators are added.'
                : 'Manually set — auto-detection disabled.'}
            </p>
          </div>
          <div data-field="proposedNames">
          <ProposedNamesEditor
            values={corp.proposedNames}
            onChange={(v) => setCorp((c) => ({ ...c, proposedNames: v }))}
            onSave={(v) => {
              const cleaned = Array.from(new Set(v.map((s) => s.trim()).filter(Boolean)));
              void saveCorpField('proposedNames', cleaned);
            }}
          />
          </div>
          <Field field="primaryPurpose" label="Primary Purpose" textarea value={corp.primaryPurpose}
            onChange={(v) => setCorp((c) => ({ ...c, primaryPurpose: v }))} onBlur={onCorpBlur('primaryPurpose')} />
          <Field field="principalOfficeAddress" label="Principal Address" textarea value={corp.principalOfficeAddress}
            onChange={(v) => setCorp((c) => ({ ...c, principalOfficeAddress: v }))} onBlur={onCorpBlur('principalOfficeAddress')} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field field="authorizedCapitalStock" label="Authorized Capital Stock (PHP)" value={corp.authorizedCapitalStock}
              onChange={(v) => setCorp((c) => ({ ...c, authorizedCapitalStock: v }))} onBlur={onCorpBlur('authorizedCapitalStock')} />
            <Field label="Par Value (PHP)" value={corp.parValue}
              onChange={(v) => setCorp((c) => ({ ...c, parValue: v }))} onBlur={onCorpBlur('parValue')} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Official Company Email" value={corp.officialEmail}
              onChange={(v) => setCorp((c) => ({ ...c, officialEmail: v }))} onBlur={onCorpBlur('officialEmail')} />
            <Field label="Alternate Company Email" value={corp.alternateEmail}
              onChange={(v) => setCorp((c) => ({ ...c, alternateEmail: v }))} onBlur={onCorpBlur('alternateEmail')} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Official Mobile Number" value={corp.officialMobile}
              onChange={(v) => setCorp((c) => ({ ...c, officialMobile: v }))} onBlur={onCorpBlur('officialMobile')} />
            <Field label="Alternate Mobile Number" value={corp.alternateMobile}
              onChange={(v) => setCorp((c) => ({ ...c, alternateMobile: v }))} onBlur={onCorpBlur('alternateMobile')} />
          </div>
          <Field label="Website" value={corp.website}
            onChange={(v) => setCorp((c) => ({ ...c, website: v }))} onBlur={onCorpBlur('website')} />
        </div>
      </section>

      {/* Section 2: Contact Person */}
      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-4">2. Contact Person</h3>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">Designated authorized representative for SEC correspondence.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="First Name" value={corp.contactFirstName}
            onChange={(v) => setCorp((c) => ({ ...c, contactFirstName: v }))} onBlur={onCorpBlur('contactFirstName')} />
          <Field label="Last Name" value={corp.contactLastName}
            onChange={(v) => setCorp((c) => ({ ...c, contactLastName: v }))} onBlur={onCorpBlur('contactLastName')} />
          <Field label="Nationality" value={corp.contactNationality}
            onChange={(v) => setCorp((c) => ({ ...c, contactNationality: v }))} onBlur={onCorpBlur('contactNationality')} />
          <Field label="Gender" value={corp.contactGender}
            onChange={(v) => setCorp((c) => ({ ...c, contactGender: v }))} onBlur={onCorpBlur('contactGender')} />
          <Field label="TIN" value={corp.contactTin}
            onChange={(v) => setCorp((c) => ({ ...c, contactTin: v }))} onBlur={onCorpBlur('contactTin')} />
          <Field label="Passport Number" value={corp.contactPassportNumber}
            onChange={(v) => setCorp((c) => ({ ...c, contactPassportNumber: v }))} onBlur={onCorpBlur('contactPassportNumber')} />
        </div>
      </section>

      {/* Section 3: Incorporators and Directors */}
      <section data-field="incorporators" className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2">3. Incorporators and Initial Directors</h3>
        <p className="text-xs text-stone-600 dark:text-stone-300 italic mb-4 leading-relaxed">
          May be natural persons of legal age, partnerships or corporations, singly or jointly with others, <strong>1 to 15</strong>.
          If only one (1) incorporator is provided, this will be set up as a <strong>One-Person Corporation (OPC)</strong> and
          OPC-specific rules apply: the sole incorporator is also the sole director and sole stockholder, and the corporation must
          designate a Nominee and Alternate Nominee. Each incorporator of a stock corporation must own or be a subscriber to at
          least one share of the capital stock.
        </p>

        <div className="space-y-4">
          {incorporators.map((p, idx) => (
            <div key={p.localKey} className="border border-stone-200 dark:border-white/10 rounded-lg p-4 bg-stone-50/40 dark:bg-white/5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-stone-600 dark:text-stone-300">Incorporator {idx + 1}</span>
                {incorporators.length > 1 && (
                  <button onClick={() => removeIncorporator(idx)} className="text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={!p.isJuridical}
                    onChange={() => {
                      updateIncorporator(idx, { isJuridical: false });
                      void saveIncorporator(idx, { ...p, isJuridical: false });
                    }}
                  />
                  <span className="text-stone-700 dark:text-stone-200">Natural Person</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={p.isJuridical}
                    onChange={() => {
                      // Switching to juridical also tears down any prior
                      // Director mirror, since juridical entities can't be
                      // directors. The persisted teardown happens in
                      // saveIncorporator; here we just unset the flag.
                      updateIncorporator(idx, { isJuridical: true, alsoDirector: false });
                      void saveIncorporator(idx, { ...p, isJuridical: true, alsoDirector: false });
                    }}
                  />
                  <span className="text-stone-700 dark:text-stone-200">Juridical Entity</span>
                </label>
              </div>

              {p.isJuridical ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <Field label="Entity Name" value={p.entityName}
                      onChange={(v) => updateIncorporator(idx, { entityName: v })} onBlur={() => saveIncorporator(idx)} />
                  </div>
                  <label className="block">
                    <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Entity Type</span>
                    <select
                      value={p.entityType}
                      onChange={(e) => {
                        updateIncorporator(idx, { entityType: e.target.value });
                        void saveIncorporator(idx, { ...p, entityType: e.target.value });
                      }}
                      className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600 bg-white dark:bg-card"
                    >
                      <option value="">— Select —</option>
                      <option value="Corporation">Corporation</option>
                      <option value="Partnership">Partnership</option>
                      <option value="Association">Association</option>
                      <option value="Cooperative">Cooperative</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                  <Field label="SEC / DTI Registration No." value={p.entityRegistrationNo}
                    onChange={(v) => updateIncorporator(idx, { entityRegistrationNo: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Nationality (country of incorporation)" value={p.nationality}
                    onChange={(v) => updateIncorporator(idx, { nationality: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="TIN" value={p.tin}
                    onChange={(v) => updateIncorporator(idx, { tin: v })} onBlur={() => saveIncorporator(idx)} />
                  <div className="md:col-span-2">
                    <Field label="Principal Office Address" value={p.residentialAddress}
                      onChange={(v) => updateIncorporator(idx, { residentialAddress: v })} onBlur={() => saveIncorporator(idx)} />
                  </div>
                  <Field label="Authorized Representative Name" value={p.representativeName}
                    onChange={(v) => updateIncorporator(idx, { representativeName: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Representative Title (e.g. President)" value={p.representativeTitle}
                    onChange={(v) => updateIncorporator(idx, { representativeTitle: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Amount of Shares Subscribed (PHP)" value={p.sharesSubscribedAmount}
                    onChange={(v) => updateIncorporator(idx, { sharesSubscribedAmount: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Amount of Shares Paid Up (PHP)" value={p.sharesPaidAmount}
                    onChange={(v) => updateIncorporator(idx, { sharesPaidAmount: v })} onBlur={() => saveIncorporator(idx)} />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="First Name" value={p.firstName}
                    onChange={(v) => updateIncorporator(idx, { firstName: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Last Name" value={p.lastName}
                    onChange={(v) => updateIncorporator(idx, { lastName: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Nationality" value={p.nationality}
                    onChange={(v) => updateIncorporator(idx, { nationality: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Residential Address" value={p.residentialAddress}
                    onChange={(v) => updateIncorporator(idx, { residentialAddress: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="TIN" value={p.tin}
                    onChange={(v) => updateIncorporator(idx, { tin: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Passport Number" value={p.passportNumber}
                    onChange={(v) => updateIncorporator(idx, { passportNumber: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Amount of Shares Subscribed (PHP)" value={p.sharesSubscribedAmount}
                    onChange={(v) => updateIncorporator(idx, { sharesSubscribedAmount: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="Amount of Shares Paid Up (PHP)" value={p.sharesPaidAmount}
                    onChange={(v) => updateIncorporator(idx, { sharesPaidAmount: v })} onBlur={() => saveIncorporator(idx)} />
                  <Field label="ESAP No." value={p.esapNo}
                    onChange={(v) => updateIncorporator(idx, { esapNo: v })} onBlur={() => saveIncorporator(idx)} />
                </div>
              )}

              {!p.isJuridical && (
                <label className="mt-3 flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={p.alsoDirector || (isOpc && idx === 0)}
                    disabled={isOpc && idx === 0}
                    onChange={(e) => {
                      updateIncorporator(idx, { alsoDirector: e.target.checked });
                      void saveIncorporator(idx, { ...p, alsoDirector: e.target.checked });
                    }}
                  />
                  <span className="text-stone-700 dark:text-stone-200">Also a Director {isOpc && idx === 0 && <span className="text-stone-400 dark:text-stone-500">(required for OPC)</span>}</span>
                </label>
              )}
              {p.isJuridical && (
                <p className="mt-3 text-xs text-stone-500 dark:text-stone-400 italic">
                  Juridical entities cannot serve as directors or corporate officers (RCC §22). Designate directors and officers from among natural persons in the relevant sections below.
                </p>
              )}
              <PersonAttachments
                personId={p.id}
                files={filesForPerson(p.id)}
                corporationId={id}
                onUploaded={(uploaded) => { if (uploaded) setFiles((prev) => [...prev, uploaded]); }}
              />
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={addIncorporator}
            disabled={incorporators.length >= 15}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add incorporator
          </button>
          <div className="text-xs text-stone-600 dark:text-stone-300">
            <span className={countOk ? '' : 'text-rose-600 dark:text-rose-400'}>
              {incorporatorCount} incorporator{incorporatorCount === 1 ? '' : 's'} {!countOk && '(must be 1–15)'}
            </span>
            <span className="ml-3">Subscribed: <span className="font-mono">{totalSubscribed.toLocaleString()}</span></span>
            <span className="ml-3">Paid-up: <span className="font-mono">{totalPaid.toLocaleString()}</span></span>
          </div>
        </div>

        {totalSubscribed > 0 && incorporators.some((p) => (parseAmount(p.sharesSubscribedAmount) ?? 0) === 0) && (
          <div className="mt-3 px-3 py-2 rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 inline-flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            One or more incorporators have zero subscribed shares — at least one share is required.
          </div>
        )}
      </section>

      {/* Section 3.5: OPC Nominees */}
      {isOpc && (
        <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2">3.5. OPC Nominees</h3>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-4">
            The Nominee takes over administration of the OPC if the sole shareholder dies or becomes incapacitated.
            The Alternate Nominee acts if the Nominee is also unavailable.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {nominee && (
              <NomineeCard
                title="Nominee"
                draft={nominee}
                onChange={(patch) => updateNominee(setNominee, patch)}
                onBlur={() => saveNominee('Nominee', nominee, setNominee)}
              />
            )}
            {altNominee && (
              <NomineeCard
                title="Alternate Nominee"
                draft={altNominee}
                onChange={(patch) => updateNominee(setAltNominee, patch)}
                onBlur={() => saveNominee('Alternate Nominee', altNominee, setAltNominee)}
              />
            )}
          </div>
        </section>
      )}

      {/* Section 4: Corporate Officers */}
      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-4">4. Corporate Officers</h3>
        {isOpc && (
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
            Under OPC rules, the sole shareholder is President by operation of law. Designate the Treasurer and Corporate Secretary below;
            the Secretary must be a different person from the sole shareholder.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['President', 'Treasurer', 'Corporate Secretary'] as const).map((slot) => {
            if (isOpc && slot === 'President') return null;
            const o = officers[slot];
            return (
              <div key={slot} className="border border-stone-200 dark:border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold text-stone-700 dark:text-stone-200">{slot}</div>
                  <PickFromExistingButton
                    people={people}
                    excludeId={o.id ?? null}
                    onPick={(source) => mirrorOfficer(slot, source)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="First Name" value={o.firstName}
                    onChange={(v) => updateOfficer(slot, { firstName: v })} onBlur={() => saveOfficer(slot)} />
                  <Field label="Last Name" value={o.lastName}
                    onChange={(v) => updateOfficer(slot, { lastName: v })} onBlur={() => saveOfficer(slot)} />
                </div>
                {(o.nationality || o.tin || o.passportNumber || o.residentialAddress) && (
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                    {o.nationality && <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300">{o.nationality}</span>}
                    {o.gender && <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300">{o.gender}</span>}
                    {o.tin && <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300 font-mono">TIN {o.tin}</span>}
                    {o.passportNumber && <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300 font-mono">PP {o.passportNumber}</span>}
                    {o.residentialAddress && <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300 truncate max-w-[16rem]" title={o.residentialAddress}>{o.residentialAddress}</span>}
                  </div>
                )}
                <PersonAttachments
                  personId={o.id}
                  files={filesForPerson(o.id)}
                  corporationId={id}
                  onUploaded={(uploaded) => { if (uploaded) setFiles((prev) => [...prev, uploaded]); }}
                />
              </div>
            );
          })}
        </div>
        {opcSecretaryConflict && (
          <div className="mt-3 px-3 py-2 rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 inline-flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Under OPC rules (RCC §122), the sole shareholder may not serve as Corporate Secretary. Designate a different person.
          </div>
        )}
      </section>

      {/* Ready-to-file checklist */}
      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3">Ready for eSPARC?</h3>
        {readyToFile ? (
          <div className="flex items-center justify-between">
            <div className="text-sm text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              All required fields are filled. The corporation is ready for SEC eSPARC filing.
            </div>
            <div className="flex items-center gap-2">
              {markReadyError && (
                <span className="text-xs text-rose-600 dark:text-rose-400">Failed to update status — try again.</span>
              )}
              <button
                onClick={markReady}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700"
              >
                Mark as Ready for eSPARC
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-stone-600 dark:text-stone-300">
            Fill in the required fields above before this corporation can be filed with the SEC.
          </div>
        )}
      </section>
    </div>
  );
}

function Field(props: {
  /** data-field, for "Fill in" on the next-steps checklist. */
  field?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  textarea?: boolean;
}) {
  return (
    <label className="block" data-field={props.field}>
      <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">{props.label}</span>
      {props.textarea ? (
        <textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={props.onBlur}
          rows={2}
          className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600"
        />
      ) : (
        <input
          type="text"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={props.onBlur}
          className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600"
        />
      )}
    </label>
  );
}

function ProposedNamesEditor(props: {
  values: string[];
  onChange: (v: string[]) => void;
  onSave: (v: string[]) => void;
}) {
  const set = (i: number, v: string) => {
    const next = [...props.values];
    next[i] = v;
    props.onChange(next);
  };
  return (
    <div>
      <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Proposed Names</span>
      <div className="space-y-2">
        {props.values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <GripVertical className="w-3.5 h-3.5 text-stone-300 shrink-0" />
            <input
              type="text"
              value={v}
              onChange={(e) => set(i, e.target.value)}
              onBlur={() => props.onSave(props.values)}
              placeholder={`Proposed name ${i + 1}`}
              className="flex-1 px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600"
            />
            {props.values.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const next = props.values.filter((_, j) => j !== i);
                  props.onChange(next);
                  props.onSave(next);
                }}
                className="text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => props.onChange([...props.values, ''])}
        className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded"
      >
        <Plus className="w-3 h-3" /> Add proposed name
      </button>
    </div>
  );
}

function NomineeCard(props: {
  title: string;
  draft: DraftPerson;
  onChange: (patch: Partial<DraftPerson>) => void;
  onBlur: () => void;
}) {
  const { draft } = props;
  return (
    <div className="border border-stone-200 dark:border-white/10 rounded-lg p-4">
      <div className="text-xs font-semibold text-stone-700 dark:text-stone-200 mb-3">{props.title}</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="First Name" value={draft.firstName}
          onChange={(v) => props.onChange({ firstName: v })} onBlur={props.onBlur} />
        <Field label="Last Name" value={draft.lastName}
          onChange={(v) => props.onChange({ lastName: v })} onBlur={props.onBlur} />
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2">
        <Field label="Nationality" value={draft.nationality}
          onChange={(v) => props.onChange({ nationality: v })} onBlur={props.onBlur} />
        <Field label="Residential Address" textarea value={draft.residentialAddress}
          onChange={(v) => props.onChange({ residentialAddress: v })} onBlur={props.onBlur} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="TIN" value={draft.tin}
            onChange={(v) => props.onChange({ tin: v })} onBlur={props.onBlur} />
          <Field label="Passport Number" value={draft.passportNumber}
            onChange={(v) => props.onChange({ passportNumber: v })} onBlur={props.onBlur} />
        </div>
      </div>
    </div>
  );
}

function PickFromExistingButton(props: {
  people: CorporationPerson[];
  excludeId: number | null;
  onPick: (source: CorporationPerson) => void;
}) {
  const [open, setOpen] = useState(false);
  const candidates = useMemo(
    () => dedupePeople(props.people).filter((p) => (p.firstName || p.lastName) && p.id !== props.excludeId),
    [props.people, props.excludeId],
  );
  if (candidates.length === 0) {
    return (
      <span className="text-[10px] text-stone-400 dark:text-stone-500 italic">
        No incorporators saved yet
      </span>
    );
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] text-navy-700 dark:text-navy-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded border border-stone-200 dark:border-white/10"
      >
        Pick from existing
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded shadow-lg max-h-72 overflow-y-auto z-20">
          {candidates.map((p) => {
            const identifier = p.passportNumber
              ? { kind: 'PP', value: p.passportNumber }
              : p.tin
                ? { kind: 'TIN', value: p.tin }
                : p.esapNo
                  ? { kind: 'ESAP', value: p.esapNo }
                  : null;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { props.onPick(p); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-stone-50 dark:hover:bg-white/5 border-b border-stone-100 dark:border-white/10 last:border-0"
              >
                <div className="font-medium text-stone-800 dark:text-stone-100">{p.firstName} {p.lastName}</div>
                <div className="mt-0.5 text-[10px] text-stone-500 dark:text-stone-400 flex flex-wrap gap-x-2">
                  <span>{p.role}</span>
                  {identifier && (
                    <span className="font-mono">{identifier.kind} {identifier.value}</span>
                  )}
                  {p.nationality && <span>· {p.nationality}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PersonAttachments(props: {
  personId: number | null;
  files: CorporationFile[];
  corporationId: string;
  onUploaded: (uploaded: CorporationFile | null) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  if (props.personId == null) {
    return (
      <div className="mt-3 text-xs text-stone-400 dark:text-stone-500 italic">
        Save this row (blur a field) to enable ID / supporting-document uploads.
      </div>
    );
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      const data = await uploadCorporationFile(props.corporationId, 'ID Copy', file, props.personId);
      props.onUploaded(data.file ?? null);
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-stone-200 dark:border-white/10">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-stone-600 dark:text-stone-300">Attached documents ({props.files.length})</span>
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50"
        >
          <Upload className="w-3 h-3" />
          {busy ? 'Uploading…' : 'Attach ID'}
        </button>
        <input
          ref={ref}
          type="file"
          className="hidden"
          accept="image/*,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = '';
          }}
        />
      </div>
      {props.files.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {props.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
              <Paperclip className="w-3 h-3 text-stone-400 dark:text-stone-500 shrink-0" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-[10px] text-stone-400 dark:text-stone-500">{f.category}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
