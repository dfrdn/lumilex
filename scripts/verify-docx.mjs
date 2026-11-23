import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const path = process.argv[2];
const samples = process.argv.slice(3);

const { data, error } = await supabase.storage.from('files').download(path);
if (error) { console.error(error); process.exit(1); }
const buf = Buffer.from(await data.arrayBuffer());
const zip = await JSZip.loadAsync(buf);
const xml = await zip.file('word/document.xml').async('string');
const leftover = (xml.match(/\{\{[^}]+\}\}/g) || []);
console.log('Bytes:', buf.length);
console.log('Leftover placeholders:', leftover.length === 0 ? 'NONE' : leftover);
console.log('Filled values present:');
for (const s of samples) console.log('  ' + (xml.includes(s) ? '✓' : '✗') + ' ' + s);
