/**
 * Seed script: the firm Style Guide resource.
 *
 * Usage: npx tsx scripts/seed-style-guide.ts <firmIdOrSlug> [--force]
 *
 * Takes the firm explicitly and writes through `getServiceDbForFirm`, which
 * stamps `firm_id` — `kb_pages.firm_id` is NOT NULL with no default, so the
 * unscoped raw client this used to build raised 23502. An existing row is left
 * alone unless `--force` is passed, so a re-run is a no-op.
 */

import { runSeed } from './resource-seed';

const FULL_CONTENT = `
<p><em>First Edition — A Handbook of Legal Style for the Lawyers of the Firm</em></p>
<hr>

<h1>Foreword</h1>
<p>Excellence in legal advocacy lies at the core of our practice — a commitment to professionalism, precision, and client service in addressing each client's unique challenges. This commitment extends beyond our legal approach to how we present our work. The documents we produce are extensions of our advocacy, and their quality must reflect the same professionalism and precision that define our Firm.</p>
<p>This Style Guide is an essential tool for ensuring consistency, efficiency, and excellence in all our written communications. By establishing clear standards for formatting, language, and presentation, it allows us to focus on crafting substantive solutions while maintaining the highest professional standards.</p>
<p>As a living document, this guide will evolve with the changing demands of the profession and our clients' needs. It is designed not only to uphold our standards but also to continuously improve our work processes, ensuring that every written product embodies our firm's commitment to excellence in legal practice.</p>

<hr>

<h1>Part One — Guidelines for All Departments</h1>
<p>This outlines the fundamental guidelines and standards to be followed by all departments. It covers general practices for document formatting, citation, language usage, and professional communication. The aim is to ensure consistency, clarity, and professionalism across all written communications. This applies to all of the Firm's written output, including letters and pleadings.</p>
<p>For clarity, this applies to the Litigation Department, except where it conflicts with the guidelines in Part Two, in which case the latter will take precedence.</p>

<h2>File Name Convention</h2>
<p>Filename shall be <em>[Matter ID] Document Title (initials).</em></p>

<h2>Font and Typeface</h2>
<h3>Typeface</h3>
<ul>
<li>For all documents except pleadings, use the default form of <strong>Adobe Garamond Pro</strong> without any additional formatting modifications.</li>
<li>Use <strong>Book Antiqua</strong> for pleadings.</li>
</ul>
<h3>Font Size</h3>
<ul>
<li>12 for Letters, Legal Opinions, and Reports (Adobe Garamond Pro)</li>
<li>14 for Pleadings (Book Antiqua)</li>
<li>Different font sizes are assigned to specific typefaces and document types, as outlined in the relevant sections below.</li>
</ul>

<h2>Writing Style and Guidelines</h2>
<h3>Tone, Voice, and Sentence Structure</h3>
<p><strong>Core Principles:</strong> Write with authority and precision while maintaining accessibility for all readers. Our communication should reflect the professionalism and expertise clients expect from the Firm.</p>

<ol>
<li>
<p><strong>Use Clear and Direct Language</strong></p>
<ul>
<li>Write in a straightforward manner, avoiding complex or convoluted sentences.</li>
<li>Aim for simplicity and clarity in all communications.</li>
<li>Choose common words over obscure alternatives when the meaning remains clear.</li>
<li>Define technical legal terms when writing for non-legal audiences.</li>
</ul>
<blockquote><p>✅ We will file your motion by Friday.<br>❌ We shall endeavor to effectuate the submission of your aforementioned motion prior to the conclusion of the current work week.</p></blockquote>
</li>

<li>
<p><strong>Prefer the Active Voice</strong></p>
<ul>
<li>Use the active voice to make sentences more direct and engaging.</li>
<li>Clearly identify who performs each action.</li>
<li>Reserve passive voice for situations where the actor is unknown or irrelevant.</li>
</ul>
<blockquote><p>✅ The court granted the motion.<br>❌ The motion was granted by the court.</p></blockquote>
</li>

<li>
<p><strong>Keep Sentences Concise</strong></p>
<ul>
<li>Limit sentences to 20–25 words when possible.</li>
<li>Break down complex ideas into shorter, more manageable sentences to enhance readability.</li>
<li>Use coordination and subordination to connect related ideas efficiently.</li>
<li>Eliminate unnecessary words and redundant phrases.</li>
</ul>
<blockquote><p>✅ The defendant failed to respond to your complaint-affidavit. The case is now submitted for resolution.<br>❌ The defendant, who was served with a subpoena to submit his counter-affidavit three weeks ago, has failed to provide any response whatsoever, which resulted in the submission of the case for resolution without his counter-affidavit.</p></blockquote>
</li>

<li>
<p><strong>Be Precise and Specific</strong></p>
<ul>
<li>Use precise terminology and avoid vague language.</li>
<li>Specify who is doing what to whom to prevent ambiguity.</li>
<li>Include relevant dates, deadlines, and specific requirements.</li>
<li>Replace general terms with concrete details when possible.</li>
</ul>
<blockquote><p>✅ The plaintiff seeks Php 50,000.00 in compensatory damages.<br>❌ The plaintiff wishes to be paid for their losses.</p></blockquote>
</li>

<li>
<p><strong>Use Proper Punctuation</strong></p>
<ul>
<li>Ensure correct punctuation to clarify meaning and enhance readability.</li>
<li>Master the proper use of commas, semicolons, colons, and dashes.</li>
<li>Use the Oxford comma consistently in all lists.</li>
<li>Apply punctuation rules consistently across all firm documents.</li>
</ul>
<blockquote><p>✅ We represent clients in contract disputes, employment law, and intellectual property matters.<br>❌ We represent clients in contract disputes, employment law and intellectual property matters.</p></blockquote>
</li>

<li>
<p><strong>Maintain Consistent Tense</strong></p>
<ul>
<li>Use a consistent tense throughout each document to avoid confusion.</li>
<li>Choose present tense for current facts and ongoing situations.</li>
<li>Use past tense for completed actions and historical events.</li>
<li>Maintain coherent temporal flow in narrative sections.</li>
</ul>
</li>

<li>
<p><strong>Organize Ideas Logically</strong></p>
<ul>
<li>Present ideas in a clear, logical sequence.</li>
<li>Use effective transitions between sentences and paragraphs.</li>
<li>Structure arguments to build from premise to conclusion.</li>
<li>Group related concepts together for maximum impact.</li>
</ul>
</li>

<li>
<p><strong>Use Parallel Structure</strong></p>
<ul>
<li>Ensure that elements in a list or series follow the same grammatical pattern.</li>
<li>Apply parallel structures to headings, bullet points, and enumerated items.</li>
<li>Maintain consistency in verb forms and sentence construction.</li>
</ul>
<blockquote><p>✅ The attorney is experienced, knowledgeable, and dedicated.<br>❌ The attorney is experienced, has knowledge, and shows dedication.</p></blockquote>
</li>
</ol>

<h3>Citations and References</h3>
<p><strong>Core Principles:</strong> Maintain consistency and accuracy in all legal citations to enhance credibility and ensure proper attribution. Citations should be clear, precise, and follow established conventions that reflect professional legal writing standards. For the complete citation format, refer to Part Three of this Style Guide.</p>

<ol>
<li>
<p><strong>Format and Presentation</strong></p>
<ul>
<li>Place legal citations and references in footnotes.</li>
<li>You may include case titles within the text when highlighting a squarely applicable case.</li>
<li>Write the initial reference to Annexes within the text.</li>
<li>Keep formatting consistent throughout the document.</li>
<li>Ensure in-text citations flow naturally with surrounding text.</li>
</ul>
</li>

<li>
<p><strong>Abbreviations and Acronyms</strong></p>
<ul>
<li>Do not abbreviate unless it improves readability.</li>
<li>Do not abbreviate a word or phrase used only once.</li>
<li>When needed, introduce the parenthetical abbreviation without quotation marks or italics.</li>
<li>Avoid phrases like "hereinafter referred to as" and similar constructions.</li>
</ul>
<blockquote><p><em>Use:</em> The parties executed the Contract of Lease dated 15 July 2019 (Contract).<br><em>Not:</em> The parties executed the Contract of Lease dated 15 July 2019 ("Contract").</p></blockquote>
</li>

<li>
<p><strong>Citing Statutes and Issuances (In-Text)</strong></p>
<ul>
<li>When citing statutes in the body text, spell them out at first mention <em>without a parenthetical abbreviation</em>. At later mentions, the abbreviated version may be used.</li>
<li>For Supreme Court-issued rules (Administrative Matters), do not spell out "Administrative Matter" — use A.M. No. at first and later mentions.</li>
<li>The following laws should not be abbreviated: Revised Penal Code, Civil Code, Labor Code, Revised Corporation Code, Anti-Dummy Law, Family Code, Tax Code, Election Code, Water Code.</li>
<li>When citing specific provisions in-text, arrange from most specific to most general. Example: Par. 2, Section 3, Article III of the Constitution.</li>
<li>Use "v." instead of "vs." Use "See..." (not "Please see"). Abbreviate "page/s" and use " - " instead of "to."</li>
<li>As a rule, use "Rules of Court" instead of the specific part, unless context requires it.</li>
</ul>
</li>

<li>
<p><strong>Jurisprudence (In-Text)</strong></p>
<ul>
<li>Jurisprudence may be cited in-line or as a footnote. When cited in-line, the short title is italicized, and the G.R. number and date are footnoted.</li>
<li>Avoid in-line parenthetical citations and use footnotes instead.</li>
</ul>
<blockquote><p><em>Use:</em> In <em>Magsi v. Heirs of Lopez</em>, the Supreme Court held that...<br>(with footnote: G.R. No. 262034, 22 May 2024.)</p></blockquote>
</li>

<li>
<p><strong>Reference to Documents</strong></p>
<ul>
<li>Italicize references to a specific, titled document. Example: The defendant has filed his <em>Answer</em> on 6 July 2024.</li>
<li>Do not italicize generic document types. Example: The defendant has not yet filed an answer.</li>
<li>Avoid creating your own designations for letters, unless the letter itself uses that designation.</li>
<li>Treat "letter" as a common noun. Do not capitalize it by default.</li>
<li><strong>Citing Annexes and Exhibits:</strong> Use format — Annex "<strong>A</strong>", Exhibit "<strong>B</strong>", Annex "<strong>1</strong>".</li>
<li>Capitalize "Annex" and set in regular font. Letter/number in bold and enclosed in quotation marks.</li>
<li>Avoid using "hereto" unless its omission might cause confusion.</li>
</ul>
</li>

<li>
<p><strong>Quotations</strong></p>
<ul>
<li><strong>In-line quotations:</strong> Use for 49 words or fewer. Enclose in quotation marks.</li>
<li><strong>Block quotations:</strong> Use for 50 words or more. Separate in a block without quotation marks. Double-indent: left and right margins 0.5 inch smaller. First line of each paragraph indented 0.5 inch.</li>
<li>When the quoted portion starts mid-sentence, use brackets to capitalize the first letter.</li>
</ul>
</li>

<li>
<p><strong>Apostrophes, Quotation Marks, and Punctuation</strong></p>
<ul>
<li>As a rule, punctuation comes before the closing quotation mark.</li>
<li>When enumerating items in quotation marks, place commas outside the closing quotation mark for each item except the last, and use the Oxford comma.</li>
</ul>
<blockquote><p>✅ Exhibits "A", "B", "C", "D", and "E".<br>❌ Exhibits "A," "B," "C," "D" and "E."</p></blockquote>
</li>

<li>
<p><strong>Emphasis and Highlighting</strong></p>
<ul>
<li>Use boldface to emphasize a word, phrase, or sentence.</li>
<li>For emphasized passages in quoted materials, add the footnote notation: "Emphasis supplied."</li>
<li>Avoid underlining for emphasis. For the Litigation Department, underlining is reserved for highlighting amended portions.</li>
<li>Avoid overemphasizing — it clutters the document and defeats the purpose of emphasis.</li>
</ul>
</li>

<li>
<p><strong>Omissions in Quotations</strong></p>
<ul>
<li>Use "xxx" to mark omitted portions in a paragraph. If the omission is at the end, no need to signify.</li>
<li>When omitting entire paragraphs in a multi-paragraph block quote, replace with "xxx" on its own line.</li>
</ul>
</li>

<li>
<p><strong>Italics</strong></p>
<ul>
<li>Use italics for case titles, whether in-line or in footnotes.</li>
<li>When the medium is English, italicize non-English words. Exceptions for familiar terms: <em>ad hoc</em>, <em>alter ego</em>, <em>bona fide</em>, <em>carte blanche</em>, <em>caveat</em>, <em>contra</em>, <em>e.g.</em>, <em>en masse</em>, <em>et al.</em>, <em>etc.</em>, <em>ex officio</em>, <em>i.e.</em>, <em>per annum</em>, <em>per capita</em>, <em>per diem</em>, <em>per se</em>, <em>postmortem</em>, and <em>sic</em>.</li>
<li>When the medium is Filipino, italicize non-Filipino words.</li>
</ul>
</li>

<li>
<p><strong>Names</strong></p>
<ul>
<li>As a general rule, use "Mr." and "Ms." when pertaining to an individual, unless context dictates otherwise.</li>
<li>State the full name at first mention, but do not immediately follow with a parenthetical abbreviation. Use the abbreviated version at later mentions.</li>
</ul>
</li>

<li>
<p><strong>Numbers</strong></p>
<ul>
<li>Spell out zero through nine. Use numerals for 10 and above, except for: numbers in quoted material, numbers that begin a sentence, proper names, age, negative integers, decimals, reference lists, footnotes, tables, and dates.</li>
<li>Do not write a number in words followed by the numeral in parentheses unless necessary.</li>
</ul>
<blockquote><p>✅ There are five defendants in this case.<br>✅ There are 26 letters in the alphabet.<br>❌ There are five (5) defendants in this case.</p></blockquote>
</li>

<li>
<p><strong>Currency</strong></p>
<ul>
<li>Use "Php" for Philippine pesos. Do not use PHP, P, or PhP.</li>
<li>Example: Php 500,000.00</li>
</ul>
</li>

<li>
<p><strong>Date and Time</strong></p>
<ul>
<li><strong>Dates:</strong> Use day–month–year format, e.g., 1 January 2025. For days 1–9, do not prefix with zero.</li>
<li><strong>Time:</strong> Use figures followed by a.m. or p.m. Include ":00" for exact hours, e.g., 8:00 p.m.</li>
</ul>
</li>

<li>
<p><strong>Archaic Words to Avoid</strong></p>
<ul>
<li><em>Thereof</em> → Prefer "of it" or "its" where appropriate.</li>
<li><em>Hereto</em> → Often unnecessary and can be omitted.</li>
<li><em>Herein</em> → Prefer "in this document" or omit if context is clear.</li>
<li><em>Said</em> (as determiner) → Prefer "the" or repeat the noun.</li>
</ul>
</li>

<li>
<p><strong>Commonly and Erroneously Interchanged Words</strong></p>
<ul>
<li><strong>Who vs. Whom vs. Whose:</strong> Who = subject of the verb; Whom = object of the verb or preposition; Whose = possession.</li>
<li><strong>Which vs. That:</strong> Which = non-restrictive clause, set off by commas; That = restrictive clause, no comma.</li>
<li><strong>Entitled vs. Titled:</strong> Entitled = having a right or claim; Titled = name of a book, article, or document.</li>
<li><strong>Shall, Must, Should, Ought:</strong> Shall = traditional mandate; prefer "must" in modern usage. Must = requirement. Should = recommendation. Ought = moral obligation; rarely used.</li>
<li><strong>Insure vs. Ensure:</strong> Insure = protect against risk via insurance; Ensure = make certain or guarantee.</li>
</ul>
</li>
</ol>

<h2>Letters</h2>
<p>The guidelines below apply to all forms of letters by the Firm, such as legal opinions, audit reports, status reports, etc.</p>

<h3>1. Basic Formatting</h3>
<ul>
<li><strong>Page Size:</strong> A4</li>
<li><strong>Margins:</strong> Pre-set by the Firm's letterhead.</li>
<li><strong>Font:</strong> Adobe Garamond Pro, Size 12</li>
<li>Portions that are in boldface and in SMALL CAPS.</li>
</ul>

<h3>2. Standard Contents</h3>
<ul>
<li><strong>Privileged and Confidential:</strong> Bold and small caps (not underlined).</li>
<li><strong>Date:</strong> Regular font.</li>
<li><strong>Addressee:</strong> Name in boldface and small caps; address in regular font.</li>
<li><strong>Attention (for juridical entities):</strong> Name in boldface regular; designation in italics.</li>
<li><strong>Subject Line:</strong> Use "Subject:" instead of "Re:" — bold but not all caps or small caps.</li>
<li><strong>Salutation:</strong> "Dear," with colon (not comma). "Gentlemen" for groups or juridical entities.</li>
<li><strong>Body:</strong> No indention, except block quotes.</li>
<li><strong>Concluding Paragraph options:</strong>
<ul>
<li><em>Legal Opinion:</em> We trust that we have sufficiently addressed your concerns.</li>
<li><em>Reply to Demand Letter:</em> We trust that we have made our client's position clear on this matter.</li>
<li><em>Status Report:</em> We will update you of further developments.</li>
</ul></li>
<li><strong>Complimentary Close:</strong> "Very truly yours,"</li>
<li><strong>Signature Line:</strong> "For the Firm:" — omit the firm name and "By:" if it fits on the first page.</li>
</ul>

<hr>

<h1>Part Two — Guidelines for the Litigation Department</h1>
<p>This outlines the guidelines specific to the Litigation Department primarily for pleadings, motions, and other submissions intended for courts and quasi-judicial bodies ("court-bound papers"). All writing and formatting guidelines in Part One apply here, except where they conflict with guidelines in this Part.</p>

<blockquote><p><strong>Efficient Use of Paper Rule Compliance:</strong> All court-bound papers must comply with A.M. No. 11-9-4-SC. Key requirements: single-spaced text, 14-size font, 13" × 8.5" paper, specific margins, and page numbers on every page including the first.</p></blockquote>

<h2>Basic Format</h2>
<ol>
<li><strong>Font Style:</strong> The Firm's default font is <strong>Book Antiqua</strong> for all court-bound papers.</li>
<li><strong>Font Space, Paper Type, and Size:</strong> <strong>Single spacing</strong>, with <strong>1.5 spacing between paragraphs</strong>, using <strong>14-size font</strong> on <strong>13" × 8.5" white bond paper</strong> (legal size). Spacing between lines: 0 pt before and 0 pt after.</li>
<li><strong>Margins:</strong> Left: 1.5", Upper: 1.2", Right: 1.0", Lower: 1.0".</li>
<li><strong>Page Numbering:</strong> Every page numbered consecutively at the <strong>bottom right-hand corner</strong>. Must appear on the first page.</li>
</ol>

<h2>Contents of Pleadings</h2>

<h3>1. Caption</h3>
<ul>
<li>Sets forth the name of the court, title of action, and docket number.</li>
<li>Court info: size 14, top center. Court name in <strong>boldface, all caps</strong>.</li>
<li>For cities, use popular usage (e.g., Makati City), except "City of Manila."</li>
<li>Spell out division numbers ≤9; spell out + parenthetical numeral for >9.</li>
<li>Party names in <strong>bold, size 14</strong>. Party designations in <em>italics</em>.</li>
<li>Title and docket number in a <strong>two-column, borderless table</strong>.</li>
<li>Use "- <em>versus</em> -" in italics, flanked by hyphens, with two blank lines above.</li>
<li>Broken line below the table, extending only across the left column, beginning and ending with "x."</li>
</ul>

<h3>2. Title of Pleading</h3>
<ul>
<li><strong>Bold, all caps, centered</strong>, default size <strong>18</strong>. Not underlined.</li>
<li>If verified, expressly state it (except for Certiorari under Rule 65).</li>
<li>Referenced documents below the title in <em>italics</em>, centered, size 14, in parentheses.</li>
<li>Use "Re:" for court decisions/orders; "to:" for opposing party's pleadings.</li>
</ul>

<h3>3. Section Headings</h3>
<p><strong>Bold, all caps, center-aligned.</strong> Not underlined or numbered unless required by procedural rules.</p>

<h3>4. Enumeration of Grounds or Arguments</h3>
<ul>
<li>Adopts Main Headings. Subheadings omitted unless integral.</li>
<li>Roman numeral centered above heading (no period after).</li>
<li>All text in <strong>bold</strong>, justified, indented 1" from both margins.</li>
</ul>

<h3>5. Argument Headings</h3>
<ul>
<li>Phrased as complete, assertive statements (e.g., "The Deed of Sale is void for being executed by a deceased person").</li>
<li><strong>Main Heading:</strong> Bold, Roman numerals, left-aligned, up to 3.5" length.</li>
<li><strong>Subheading:</strong> Bold, capital letters, aligned under Main Heading.</li>
<li><strong>Tertiary Heading:</strong> Bold, combined letter-number format (A.1, A.2, B.1).</li>
</ul>

<h3>6. Contextual Headings</h3>
<p><strong>Bold italics</strong>, no numbering, indented 0.5" from left margin. Max 3.5" length.</p>

<h3>7. Paragraphs</h3>
<ul>
<li>Single main idea per paragraph, numbered consecutively.</li>
<li>First line indented <strong>1 inch</strong>, number before the second half-inch.</li>
<li>Subparagraphs: multi-level list (1.1, 1.2, 1.3). Indented 1.5" from left.</li>
<li>Enumerations: lowercase letters (a, b, c). Sub-points: lowercase Roman (i, ii, iii).</li>
<li>In-line enumerations: <em>(i), (ii), (iii)</em> in italics. Commas for short phrases; semicolons for complex ones.</li>
</ul>

<h3>8. Prayer or Relief</h3>
<ul>
<li>"<strong>WHEREFORE</strong>" in bold, all caps. Active voice preferred.</li>
<li>Specific reliefs numbered 1, 2, 3. Sub-items: lowercase letters.</li>
<li>General prayer: "(party) also prays for other reliefs that are just and equitable under the circumstances."</li>
<li>For manifestations/compliances: "Respectfully submitted." in regular font.</li>
</ul>

<h3>9. Place and Date</h3>
<p>Indicate city where prepared (Makati City) and where court is located. Same city = state once. Date should match intended filing date.</p>

<h3>10. Firm Address and Lawyers' Signature</h3>
<ul>
<li>Single column <strong>bordered table</strong>, right-aligned.</li>
<li>Firm name in <strong>boldface, all caps</strong>.</li>
<li>Representation as counsel in <em>italics</em>.</li>
<li>Lawyer names in <strong>boldface, all caps</strong>.</li>
<li>Under each signature: Roll Number, IBP info, PTR, MCLE compliance, and email address.</li>
</ul>

<h3>11. Copy Furnish and Explanation</h3>
<ul>
<li>"<strong>COPY FURNISHED:</strong>" in bold, all caps, left side below most junior lawyer's signature.</li>
<li>Addressee name/firm in <strong>bold</strong>. Designation in <em>italics</em>. Include email if available.</li>
<li>Explanation may be included after last Copy Furnished (no separate heading needed).</li>
</ul>

<h2>Style, Preferences, and Usage</h2>

<h3>1. Pleading Introduction</h3>
<ul>
<li>No section heading number. First line indented.</li>
<li>Start by stating which party the Firm represents.</li>
<li>If name needed, write in small caps. Comma after party designation, before name.</li>
<li>Ensure verb agreement with party designation ("states" / "state").</li>
<li>Avoid colorful language like "vehemently oppose." Use neutral, concise language.</li>
</ul>
<blockquote><p>Plaintiff, by counsel, respectfully states:<br>Private respondents, by counsel, respectfully state:</p></blockquote>

<h3>2. Reference to Parties</h3>
<ul>
<li>Refer as "plaintiff," "defendant," "complainant," "accused," "petitioner," "respondent."</li>
<li>In cases with several parties or appellate proceedings, names may be used for clarity.</li>
<li>Do not precede with "the." Example: "Defendant filed an <em>Answer</em> dated 23 September 2024."</li>
</ul>

<h3>3–10. Additional Style Rules</h3>
<ul>
<li><strong>Quotations:</strong> Follow Part One guidelines.</li>
<li><strong>Comment vs. Opposition:</strong> Use appropriate terminology.</li>
<li><strong>Opposing Party's Pleading:</strong> Reference accurately and completely.</li>
<li><strong>Decisions, Resolutions, Orders:</strong> Cite properly and completely.</li>
<li><strong>Statement of Receipt or Timeliness:</strong> Include proper statements regarding timely filing.</li>
<li><strong>Attaching Documents:</strong> Follow Part One guidelines for Annexes and Exhibits.</li>
<li><strong>Present Case:</strong> Reference the current case appropriately.</li>
<li><strong>Status Report of Hearings:</strong> Provide accurate and complete reports.</li>
</ul>

<h2>Special Pleadings and Documents</h2>
<ol>
<li><strong>Answer</strong> — Follow specific formatting and content requirements.</li>
<li><strong>Judicial Affidavit</strong> — Adhere to the Judicial Affidavit Rule requirements for affidavits submitted in lieu of direct testimony.</li>
<li><strong>Formal Offer of Evidence</strong> — Follow proper procedures for formally offering evidence.</li>
<li><strong>Comment on Formal Offer of Evidence</strong> — Provide appropriate responses to opposing parties' formal offers.</li>
<li><strong>Verification and Certification against Forum Shopping</strong> — Include as required by the Rules of Court.</li>
</ol>

<hr>

<h1>Part Three — Simplified Citation Guide</h1>
<p>This Part provides the Firm's citation standards for <strong>footnote citations</strong>, adapted from the <em>Ateneo Law Journal Legal Citation Guide</em> (4th Edition, 2020). The Firm adopts a simplified version of the Ateneo system for use across all documents.</p>

<blockquote><p><strong>In case of conflict between Parts One and Three, Part One prevails.</strong> Part One governs general writing conventions. Part Three governs the specific format of footnote citations.</p></blockquote>

<blockquote><p><strong>General Principle:</strong> A citation is complete when a reader is given sufficient information to locate and verify the source. Citations should be placed in footnotes unless an in-line citation is appropriate per Part One.</p></blockquote>

<h2>Fundamentals of Citation</h2>

<h3>Use of Citations</h3>
<p>A citation refers to the sentence or clause immediately preceding it. Citations are intended to: (a) attribute non-original ideas; (b) provide authorities relevant to the discussion; or (c) offer sources for further study or research.</p>

<h3>Order of Authorities</h3>
<p>Cite first the sources to which non-original ideas are attributed. Authorities for support come before those in opposition. Support or opposition may be direct, indirect, or analogous.</p>

<h3>Introductory Signals</h3>
<p><strong>Signals for Support or Attribution:</strong></p>
<ul>
<li><strong>No signal:</strong> Direct support or source identification.</li>
<li><em>See:</em> Clearly but indirectly supports the text.</li>
<li><em>See, e.g.:</em> Supplies an example of what is asserted.</li>
<li><em>See also:</em> Additional indirect authority.</li>
<li><em>Cf.:</em> Analogous support for a different proposition.</li>
</ul>
<p><strong>Signals for Divergence:</strong></p>
<ul>
<li><em>Contra:</em> Directly contradicts the text.</li>
<li><em>But see:</em> Indirectly contradicts the text.</li>
<li><em>But cf.:</em> Supports a proposition analogous to the contrary.</li>
</ul>
<p><strong>Signal for Further Research:</strong></p>
<ul>
<li><em>See generally:</em> Provides background material.</li>
</ul>

<h3>Pinpoint Citations</h3>
<ul>
<li>Cite from main divisions down to subdivisions where the portion may be found.</li>
<li>Use "at" only for page numbers, not other subdivisions.</li>
<li>Retain only last two digits of last page in ranges (e.g., 751-58, 1203-07) except when prior digit changes (1398-1400).</li>
<li>Use § for sections, ¶ for numbered paragraphs, "para." for unnumbered paragraphs.</li>
</ul>

<h3>Short Citation Forms</h3>
<p><strong>1. <em>Supra</em></strong> — For subsequently citing an authority previously cited in full.</p>
<p>Format: &lt;Author/Title&gt;, <em>supra</em> note &lt;footnote no.&gt;, &lt;pinpoint&gt;.</p>
<blockquote><p>Tolentino, <em>supra</em> note 2, at 112.<br>Tuazon, <em>supra</em> note 18, at 50.</p></blockquote>

<p><strong>2. <em>Id.</em></strong> — For citing the same authority as the immediately preceding citation.</p>
<p>Format: <em>Id.</em> &lt;pinpoint, if different&gt;.</p>
<ul>
<li>"at" only after <em>Id.</em> for pages, not other subdivisions.</li>
<li>If cited five consecutive times as <em>Id.</em>, switch to <em>supra</em> or prescribed short form.</li>
</ul>
<blockquote><p><em>Id.</em> at 142.<br><em>Id.</em> § 35 (h).<br><em>Id.</em></p></blockquote>

<p><strong>3. Hereinafter</strong> — For authorities too confusing or burdensome to cite repeatedly. Always accompanied by <em>supra</em> in subsequent citations.</p>

<h2>Primary Authorities</h2>

<h3>Constitutions</h3>
<p><strong>Incumbent:</strong> Phil. Const. art. XI, § 3 (6). — Always cite in full. No <em>supra</em> or <em>Id.</em></p>
<p><strong>Repealed:</strong> 1935 Phil. Const. art. VI, §§ 1 &amp; 5 (superseded in 1973).</p>

<h3>Codes and Statutes</h3>
<p><strong>Codes — Initial:</strong> Full Title [Short Title], statute no., pinpoint (year).</p>
<p><strong>Codes — Subsequent:</strong> Short Title, pinpoint. No <em>supra</em>; <em>Id.</em> may be used.</p>
<blockquote><p><em>Initial:</em> An Act to Ordain and Institute the Civil Code [Civil Code], RA No. 386, art. 415 (10) (1949).<br><em>Subsequent:</em> Civil Code, art. 415 (10).</p></blockquote>
<p><strong>Statutes — Initial:</strong> Full Title [Short Title], statute no., pinpoint (year). Short title in Roman font (not Small Caps).</p>
<blockquote><p><em>Initial:</em> An Act Defining Gender-Based Sexual Harassment... [Safe Spaces Act], RA No. 11313, § 6 (2019).<br><em>Subsequent:</em> Safe Spaces Act, § 3 (a).</p></blockquote>

<h3>Cases</h3>
<p><strong>Reported — Initial:</strong> <em>Case Title</em>, docket no., vol. Reporter page, pinpoint (court year).</p>
<p><strong>Reported — Subsequent:</strong> <em>Short Case Title</em>, vol. Reporter at pinpoint.</p>
<blockquote><p>Morfè v. Mutuc, 130 Phil. 415, 440 (1968).<br>Serrano v. Gallant Maritime Services, Inc., G.R. No. 167614, 582 SCRA 254, 295 (2009).<br><em>Morfè</em>, 130 Phil. at 440.</p></blockquote>
<p><strong>Online cases:</strong> Add ", <em>available at</em> &lt;URL&gt; (last accessed &lt;date&gt;)."</p>
<p><strong>Opinions other than majority:</strong> Add parenthetical, e.g., "(C.J. Sereno, concurring and dissenting opinion)."</p>

<h3>Legislative Materials</h3>
<p><strong>Bills:</strong> Title, H.B./S.B. No., pinpoint, legislature, session (year).</p>
<p><strong>Resolutions:</strong> Title, H./S. Res. No., pinpoint, legislature, session (year).</p>

<h3>Executive Materials</h3>
<p><strong>Issuances — Initial:</strong> Title, Issuance Type and No., pinpoint (date).</p>
<p><strong>IRR:</strong> IRR of [statute], pinpoint (year).</p>

<h3>Rules of Procedure</h3>
<p><strong>Rules of Court:</strong> Rules of Court, pinpoint. Always cite in full; no <em>supra</em>; <em>Id.</em> may be used.</p>

<h2>Secondary Authorities</h2>
<h3>Books</h3>
<p><strong>Single Author — Initial:</strong> vol. Author Name, Title of Book, pinpoint (ed. year).</p>
<p><strong>Subsequent:</strong> vol. Author Last Name, <em>supra</em> note #, at pinpoint.</p>
<blockquote><p>4 Arturo M. Tolentino, Commentaries and Jurisprudence on the Civil Code 470 (1991).<br>4 Tolentino, <em>supra</em> note 2, at 112.</p></blockquote>
<p><strong>Two Authors:</strong> Use "&amp;" between names. <strong>Three+:</strong> First author, et al.</p>

<h3>Journal Articles</h3>
<p>Author, <em>Title</em>, vol. Journal page, pinpoint (year).</p>
<blockquote><p>Cesar L. Villanueva, <em>Revisiting the Philippine "Laws" on Corporate Rehabilitation</em>, 43 Ateneo L.J. 183, 184 (1999).</p></blockquote>

<h3>Internet Sources</h3>
<p>Author, <em>Title</em>, Website (date), <em>available at</em> URL (last accessed date).</p>

<hr>

<h2>Appendix A — Quick Reference: Formatting Specifications</h2>
<table>
<thead><tr><th>Document Type</th><th>Font</th><th>Size</th><th>Paper</th><th>Spacing</th><th>Margins (L/T/R/B)</th></tr></thead>
<tbody>
<tr><td>Letters</td><td>Adobe Garamond Pro</td><td>12</td><td>A4</td><td>Per letterhead</td><td>Per letterhead</td></tr>
<tr><td>Legal Opinions / Reports</td><td>Adobe Garamond Pro</td><td>12</td><td>A4</td><td>Per letterhead</td><td>Per letterhead</td></tr>
<tr><td>Pleadings</td><td>Book Antiqua</td><td>14</td><td>13" × 8.5"</td><td>Single (1.5 between ¶)</td><td>1.5" / 1.2" / 1.0" / 1.0"</td></tr>
</tbody>
</table>

<h2>Appendix B — Common Abbreviations for Statutes and Issuances</h2>
<table>
<thead><tr><th>Full Form</th><th>Abbreviated Form</th></tr></thead>
<tbody>
<tr><td>Republic Act</td><td>RA No.</td></tr>
<tr><td>Commonwealth Act</td><td>CA No.</td></tr>
<tr><td>Batas Pambansa</td><td>BP Blg.</td></tr>
<tr><td>Act</td><td>Act No.</td></tr>
<tr><td>Executive Order</td><td>EO No.</td></tr>
<tr><td>Administrative Matter</td><td>A.M. No.</td></tr>
<tr><td>OCA Circular</td><td>OCA Circular No.</td></tr>
<tr><td>DOJ Circular</td><td>DOJ Circular No.</td></tr>
</tbody>
</table>

<h2>Appendix C — Common Abbreviations for Courts</h2>
<table>
<thead><tr><th>Full Form</th><th>Abbreviated Form</th></tr></thead>
<tbody>
<tr><td>Supreme Court</td><td>Do not abbreviate</td></tr>
<tr><td>Court of Appeals</td><td>CA</td></tr>
<tr><td>Regional Trial Court</td><td>RTC</td></tr>
<tr><td>Metropolitan Trial Court</td><td>MeTC</td></tr>
<tr><td>Municipal Trial Court in Cities</td><td>MTCC</td></tr>
<tr><td>Municipal Trial Court</td><td>MTC</td></tr>
<tr><td>Municipal Circuit Trial Court</td><td>MCTC</td></tr>
<tr><td>Sandiganbayan</td><td>Do not abbreviate</td></tr>
<tr><td>Court of Tax Appeals</td><td>CTA</td></tr>
</tbody>
</table>

<h2>Appendix D — Laws That Should Not Be Abbreviated</h2>
<p>Revised Penal Code · Civil Code · Labor Code · Revised Corporation Code · Anti-Dummy Law · Family Code · Tax Code · Election Code · Water Code</p>

<h2>Appendix E — Citation Quick Reference</h2>
<table>
<thead><tr><th>Source Type</th><th>Initial Citation Format</th><th>Short Form</th></tr></thead>
<tbody>
<tr><td>Constitution</td><td>Phil. Const. art. XI, § 3 (6).</td><td>Always cite in full</td></tr>
<tr><td>Code</td><td>Full Title [Short Title], statute no., § (year).</td><td>Short Title, §.</td></tr>
<tr><td>Statute</td><td>Full Title [Short Title], statute no., § (year).</td><td>Short Title or statute no., §.</td></tr>
<tr><td>Reported Case</td><td><em>Case Title</em>, G.R. No., vol. Reporter page (year).</td><td><em>Short Title</em>, vol. Reporter at page.</td></tr>
<tr><td>Online Case</td><td><em>Case Title</em>, docket no., date, <em>available at</em> URL.</td><td><em>Short Title</em>, docket no., pinpoint.</td></tr>
<tr><td>Book</td><td>Author, Title page (ed. year).</td><td>Author, <em>supra</em> note #, at page.</td></tr>
<tr><td>Journal Article</td><td>Author, <em>Title</em>, vol. Journal page (year).</td><td>Author, <em>supra</em> note #, at page.</td></tr>
<tr><td>Executive Issuance</td><td>Title, Issuance Type and No., § (date).</td><td>Issuance Type and No., §.</td></tr>
<tr><td>Rules of Court</td><td>Rules of Court, rule #, §.</td><td>Rules of Court, rule #, §.</td></tr>
</tbody>
</table>

<hr>
<p><em>This Style Guide is a living document and will be updated as the Firm's standards evolve. For questions or suggestions, please coordinate with the Style Committee.</em></p>
`;

runSeed('seed-style-guide', {
  slug: 'style-guide',
  title: 'Style Guide',
  excerpt:
    'The firm handbook of legal style — document formatting, citation, language usage, and the drafting conventions for letters and pleadings.',
  content: FULL_CONTENT.trim(),
  pinned: true,
});
