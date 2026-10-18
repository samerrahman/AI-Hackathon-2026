# Official implementation references

Checked during preparation on October 17, 2026. Model availability, provider capabilities, and SDK signatures can change. Codex should verify the actual environment before choosing model IDs or copying API calls.

- [Gemini document understanding](https://ai.google.dev/gemini-api/docs/document-processing): multimodal PDF input and document processing. Used to ground the feasibility of reading both visual and textual lecture content.
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output): schema-constrained responses. Structural validity does not establish factual correctness.
- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk): real-time interaction capabilities.
- [Live API tool use](https://ai.google.dev/gemini-api/docs/live-api/tools): function/tool integration during conversation.
- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/): page rendering and viewport examples.
- [PDF.js API](https://mozilla.github.io/pdf.js/api/): document/page APIs for the actual library version.
- [PyMuPDF text extraction](https://pymupdf.readthedocs.io/en/latest/app1.html): text extraction with positional data if a Python-side document pipeline is used.
- [Betty's Brain project](https://build.teachableagents.org/research/bettysbrain.php): prior work on learning by teaching a computer agent. Included to avoid presenting the general pedagogical idea as entirely new.

The product behavior, interface design, prompt templates, sample lecture texts, and acceptance cases in this packet are proposed design work. They are not reproduced from these sources and are not claims of validated learning outcomes.

The current scope intentionally excludes Canvas and video integration. Earlier research on those capabilities does not add them back into the implementation brief.
