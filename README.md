# Tyasi — eBay Marketplace Account Deletion Webhook

Handles eBay's required account deletion/closure notifications.

---

## Deploy to Vercel (5 minutes)

### 1. Create a new repo on GitHub
Upload all these files to a new repository (e.g. `tyasi-ebay-webhook`).

### 2. Deploy to Vercel
- Go to vercel.com → New Project → Import your repo
- Vercel auto-detects the config. Just click Deploy.
- Your endpoint URL will be: `https://your-project.vercel.app/api/marketplace-deletion`

### 3. Add Environment Variables in Vercel
Go to your project → Settings → Environment Variables and add:

| Variable | Value |
|---|---|
| `EBAY_VERIFICATION_TOKEN` | A token YOU make up (letters, numbers, dashes, underscores — min 32 chars) |
| `EBAY_ENDPOINT_URL` | `https://your-project.vercel.app/api/marketplace-deletion` |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase service role key (not the anon key) |

### 4. Run this Supabase migration
The deletion logic looks up users by their eBay user ID.
Add the column if it doesn't exist yet:

```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ebay_user_id TEXT UNIQUE;
```

Make sure to store the eBay user ID when users connect their eBay account during onboarding.

### 5. Register the endpoint with eBay
- Go to: https://developer.ebay.com/my/push?env=production&index=0
- Notification Endpoint URL: `https://your-project.vercel.app/api/marketplace-deletion`
- Verification Token: (the token you set in step 3)
- Alert Email: your email address
- Click Save — eBay will immediately send a GET challenge to your endpoint to verify it.

### 6. Subscribe to the notification
Once the endpoint validates, the Marketplace Account Deletion subscription option
will appear. Enable it.

---

## How it works

**Verification (GET):**
eBay sends `GET /api/marketplace-deletion?challenge_code=xxx`
The endpoint responds with `SHA-256(challengeCode + verificationToken + endpointUrl)`

**Deletion (POST):**
eBay sends a POST with the eBay username and userId of the deleted account.
The endpoint looks up the matching Tyasi user by `ebay_user_id` and deletes
all their data from Supabase in the correct FK-safe order.

**Tables deleted (in order):**
1. ai_rate_limits
2. team_activity
3. ambient_feed_items
4. user_category_stats
5. user_outcome_data
6. strategy_executions
7. user_strategies
8. user_inventory
9. listing_drafts
10. user_watchlists
11. user_theses
12. user_groups
13. tasks
14. team_members
15. users
