# Social Garant Market — red/black compact shopping update

This build keeps the existing `.env` unchanged and updates only the Social/Garant mini app files.

## Updated
- Social mini app redesigned as compact shopping-style catalog.
- White background, solid red/black colors, no gradients.
- Border radius reduced to 3px across cards, buttons, inputs, panels, and bottom navbar.
- Small fonts, compact spacing, two-column service catalog.
- Inline SVG premium-style icons with lightweight CSS motion.
- Bottom navbar added: Catalog, Request, Garant, Referral, Status.
- Request form simplified to fewer practical inputs.
- Admin panel link fixed with absolute `/social/admin` base path handling.
- Admin panel redesigned compact red/black style.
- Referral code and referral share support added.
- Trade group/admin redirect buttons added.
- Admin notification includes contact and referral information.

## Important
- Start command remains: `node server.js`
- Build command remains: `npm install`
- `.env` was not modified.
