'use client';

import { createContext, useContext } from 'react';
import {
  NO_FEATURES,
  type FeatureFlags,
  type FeatureKey,
} from '@/lib/firm/feature-shape';

/**
 * The current firm's feature flags, resolved once server-side in each role
 * layout and read by the client shells that draw navigation.
 *
 * Context rather than props, for the reason `BrandProvider` gives: the role
 * shells mount from ~120 page files (67 for DashboardShell alone), so a flags
 * prop threaded through all of them is a prop one new page will forget — and
 * that page then advertises a link to a route the server redirects away from.
 *
 * The default is everything off, never everything on. A subtree rendered
 * outside the provider shows no gated entry rather than guessing one into
 * existence.
 */
const FeatureContext = createContext<FeatureFlags>(NO_FEATURES);

export function FeatureProvider({
  features,
  children,
}: {
  features: FeatureFlags;
  children: React.ReactNode;
}) {
  return <FeatureContext.Provider value={features}>{children}</FeatureContext.Provider>;
}

export function useFeatures(): FeatureFlags {
  return useContext(FeatureContext);
}

/** One flag, for a component that only cares about a single feature. */
export function useFeature(key: FeatureKey): boolean {
  return useFeatures()[key];
}
