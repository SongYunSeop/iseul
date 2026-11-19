-- 0.2.0: quote comments. JSON {text, prefix, suffix, index} of the passage a comment quotes.
ALTER TABLE comments ADD COLUMN quote TEXT;
