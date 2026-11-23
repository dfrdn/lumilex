# Bundled document typefaces

Each subdirectory here is one **curated font set** that a firm can select by name
via `firms.branding.fontSet`. The registry that names them lives in
[`lib/pdf/fonts.ts`](../../lib/pdf/fonts.ts).

## What ships today

| set | faces | embedded |
| --- | --- | --- |
| `standard` (default) | Cormorant display · EB Garamond body — [`garamond/`](garamond/) | yes, as subsets |
| `core` | Helvetica display · Times body | no |
| `serif` | Times throughout | no |
| `sans` | Helvetica throughout | no |

`core`, `serif` and `sans` are built entirely from the 14 standard PDF fonts:
nothing is embedded, nothing is redistributed, and every PDF reader already has
them. They stay available as a genuine choice — a firm that wants zero font data
in the documents it sends out picks one, and they are what to fall back to if a
bundled face ever has to be pulled.

`garamond/` holds the two open-licensed families that make up the default set,
their SIL Open Font Licences, and a `LICENSE` recording where each file came
from and how it was cut. Both families carry ₱ (U+20B1), which is why `standard`
declares `hasPesoGlyph: true`.

## Adding a set

1. Create `public/fonts/<set>/` and put the face files in it. **One face per
   file** — not a variable font with several named instances. pdfkit dedupes
   embedded fonts on their name records and `head.checkSumAdjustment`, which
   every instance of one variable file shares, so a bold registered off the same
   file as the regular silently renders in the regular weight. Cut static
   instances first (`fonttools varLib.instancer … --update-name-table`).
2. **Commit the licence beside them as `public/fonts/<set>/LICENSE`.** Only
   licences that permit redistribution qualify — SIL Open Font License, Apache
   2.0, Ubuntu Font Licence. `registerFonts()` refuses to render a set whose
   `LICENSE` is missing, and refuses to substitute another face for a missing
   file: a document silently set in the wrong typeface is a brand failure nobody
   notices until it is in a client's inbox.
3. Add the entry to `FONT_SETS` in `lib/pdf/fonts.ts`, including `docxFamily`
   (the Word family name the DOCX renderers ask for) and `hasPesoGlyph`. Check
   that last one against the files rather than assuming it — every face in the
   set has to carry ₱ U+20B1, or amounts print with a "P" prefix instead of a
   notdef box:

   ```
   node -e 'const f=require("fontkit").openSync("public/fonts/<set>/<face>.ttf");
            console.log(f.hasGlyphForCodePoint(0x20B1))'
   ```

4. Render and look at the pages: `npx tsx scripts/render-brand-samples.ts`, then
   `pdftoppm -png -r 100 .brand-samples/fee-schedule.pdf out`. The script checks
   that each weight arrived as its own embedded subset and that every glyph shown
   decodes, which is what catches a collapsed weight or a missing glyph.

`./public/fonts/**` is already pinned in `next.config.ts`
`outputFileTracingIncludes` for every route that renders a document, so a new set
ships to the serverless functions without further configuration.

## What is *not* allowed here

Commercially licensed faces. This is a multi-tenant product: anything in this
directory is redistributed to every firm on the platform. The original
single-firm brand kit used Adobe Garamond Pro, Felix Titling and Forum; those
files now live outside the repo in the tenant's own private asset store.
