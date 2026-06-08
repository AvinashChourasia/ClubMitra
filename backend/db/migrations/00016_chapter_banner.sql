-- +goose Up

-- Clubs already have a `logo` column (a small circular mark); `banner` is the
-- wide hero image shown behind the club header. Both hold Cloudinary URLs and
-- are optional. logo was added in 00007; this adds its companion.
ALTER TABLE chapters ADD COLUMN banner TEXT;

-- +goose Down
ALTER TABLE chapters DROP COLUMN banner;
