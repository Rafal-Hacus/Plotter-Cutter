# Sticker sheet builder

A single-file browser tool (`index.html`) for print-and-cut work on a Skycut with SignCut-style registration marks:
nested sticker sheets with kiss and die (easy-peel) cut lines, business cards, vouchers, card decks, guillotine
sheets, vinyl/pen cutting, and PLT export.

Open `index.html` in a browser. Nothing is uploaded anywhere; the PDF libraries (pdf.js, pdf-lib) are loaded from
jsDelivr with pinned versions and Subresource Integrity, and a Content-Security-Policy blocks every other network access.

## Notes on the cut paths

- The easy-peel (die) line is the kiss outline grown by the margin, so it sits the margin away from the kiss
  line everywhere (checked to within ±0.05 mm), except that notches narrower than the "join cut lines" distance get
  filled in and rounded. Set that to 0 to follow every notch.
- The PLT output matches the cut SVG to within 0.012 mm (1/40 mm rounding). With a blade offset set, the blade
  tip stays within 0.07 mm of the line. Set the cutter's own blade offset to 0, otherwise corners are compensated
  twice.
- Each PLT starts with a short V cut along the printed start arrow (outside the marks) that sets the blade's
  direction.
