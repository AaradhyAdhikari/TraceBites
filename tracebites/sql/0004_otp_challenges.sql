-- One-time codes.
--
-- Until now a code was generated, printed to the console, and never checked:
-- any six digits signed you in, so a phone number was a login. Every
-- role-based rule in the product rested on that.
--
-- Codes are stored hashed and peppered, expire, are attempt-limited and
-- single-use. The plaintext is never written down anywhere.

CREATE TABLE IF NOT EXISTS otp_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,
  code_hash    text NOT NULL,
  purpose      text NOT NULL DEFAULT 'signin',   -- signin | signup
  expires_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Verification looks up the newest live challenge for a phone.
CREATE INDEX IF NOT EXISTS otp_phone_created_idx ON otp_challenges (phone, created_at DESC);
-- Rate limiting counts recent sends per phone.
CREATE INDEX IF NOT EXISTS otp_phone_window_idx ON otp_challenges (phone, created_at);
