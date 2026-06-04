# Social/Garant Market persistent MongoDB fix

This update makes Social/Garant Market use persistent MongoDB storage only for users, statistics, services, marketplace items, requests, and settings.

Key changes:
- Social bot now connects to MongoDB before accepting traffic, similar to GiftGo.
- Admin create/update/delete actions no longer save to temporary Render filesystem fallback.
- If MongoDB is unavailable, writes wait for reconnection and then return a clear error instead of pretending to save locally.
- Root server can reuse the same MONGODB_URI/GIFTGO_MONGODB_URI for Social when SOCIAL_MONGODB_URI is not set.
- Existing local fallback data, if present in the deployed folder, is migrated into MongoDB once on boot.
- Products, services, users, requests, referral stats, and dashboard stats persist across Render restarts/redeploys as long as MONGODB_URI points to the same MongoDB database.

Render commands remain:
Build Command: npm install
Start Command: node server.js
