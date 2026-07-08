const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN;
const ENDPOINT_URL = process.env.EBAY_ENDPOINT_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// eBay sends a GET with ?challenge_code=xxx to verify you own the endpoint.
// You must respond with SHA-256(challengeCode + verificationToken + endpointUrl).
function buildChallengeResponse(challengeCode) {
  return crypto
    .createHash('sha256')
    .update(challengeCode + VERIFICATION_TOKEN + ENDPOINT_URL)
    .digest('hex');
}

// Delete all data for a Tyasi user by their internal user UUID.
// Deletes in child-first order to respect FK constraints.
async function deleteUserData(supabase, userId) {
  const tables = [
    { table: 'ai_rate_limits',       column: 'user_id' },
    { table: 'team_activity',        column: 'user_id' },
    { table: 'ambient_feed_items',   column: 'user_id' },
    { table: 'user_category_stats',  column: 'user_id' },
    { table: 'user_outcome_data',    column: 'user_id' },
    { table: 'strategy_executions',  column: 'inventory_id', via: { table: 'user_inventory', column: 'user_id', select: 'id' } },
    { table: 'user_strategies',      column: 'user_id' },
    { table: 'user_inventory',       column: 'user_id' },
    { table: 'listing_drafts',       column: 'user_id' },
    { table: 'user_watchlists',      column: 'user_id' },
    { table: 'user_theses',          column: 'user_id' },
    { table: 'user_groups',          column: 'user_id' },
    { table: 'tasks',                column: 'created_by' },
    { table: 'tasks',                column: 'assigned_to' },
    { table: 'team_members',         column: 'owner_user_id' },
    { table: 'team_members',         column: 'member_user_id' },
    { table: 'users',                column: 'id' },
  ];

  const errors = [];

  for (const entry of tables) {
    // Handle indirect FK (strategy_executions -> user_inventory -> user)
    if (entry.via) {
      const { data: rows } = await supabase
        .from(entry.via.table)
        .select(entry.via.select)
        .eq(entry.via.column, userId);

      if (rows && rows.length > 0) {
        const ids = rows.map(r => r[entry.via.select]);
        const { error } = await supabase
          .from(entry.table)
          .delete()
          .in(entry.column, ids);
        if (error) errors.push(`${entry.table}: ${error.message}`);
      }
      continue;
    }

    const { error } = await supabase
      .from(entry.table)
      .delete()
      .eq(entry.column, userId);

    if (error) errors.push(`${entry.table}: ${error.message}`);
  }

  return errors;
}

module.exports = async function handler(req, res) {
  // --- GET: eBay challenge verification ---
  if (req.method === 'GET') {
    const challengeCode = req.query.challenge_code;

    if (!challengeCode) {
      return res.status(400).json({ error: 'Missing challenge_code' });
    }

    if (!VERIFICATION_TOKEN || !ENDPOINT_URL) {
      console.error('Missing EBAY_VERIFICATION_TOKEN or EBAY_ENDPOINT_URL env vars');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const challengeResponse = buildChallengeResponse(challengeCode);
    return res.status(200).json({ challengeResponse });
  }

  // --- POST: eBay account deletion notification ---
  if (req.method === 'POST') {
    const body = req.body;

    // Validate it's the right topic
    if (body?.metadata?.topic !== 'MARKETPLACE_ACCOUNT_DELETION') {
      return res.status(200).json({ received: true, action: 'ignored - not a deletion event' });
    }

    const ebayUsername = body?.notification?.data?.username;
    const ebayUserId   = body?.notification?.data?.userId;

    console.log(`[eBay Deletion] Received request for eBay user: ${ebayUsername} (${ebayUserId})`);

    if (!ebayUsername && !ebayUserId) {
      return res.status(400).json({ error: 'No user identifier in payload' });
    }

    // Look up Tyasi user by stored ebay_user_id.
    // NOTE: Requires an ebay_user_id column on the users table.
    // Run this migration if not already present:
    //   ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ebay_user_id TEXT UNIQUE;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: user, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('ebay_user_id', ebayUserId)
      .single();

    if (lookupError || !user) {
      // User not found — either they never signed up or already deleted.
      // Return 200 so eBay doesn't keep retrying.
      console.log(`[eBay Deletion] No Tyasi user found for eBay ID ${ebayUserId} — nothing to delete.`);
      return res.status(200).json({ received: true, action: 'no_user_found' });
    }

    const errors = await deleteUserData(supabase, user.id);

    if (errors.length > 0) {
      console.error(`[eBay Deletion] Errors deleting user ${user.id}:`, errors);
      // Still return 200 to prevent eBay retrying — log and investigate manually.
      return res.status(200).json({ received: true, action: 'partial_delete', errors });
    }

    console.log(`[eBay Deletion] Successfully deleted all data for Tyasi user ${user.id}`);
    return res.status(200).json({ received: true, action: 'deleted' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
