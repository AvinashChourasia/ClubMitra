-- +goose Up

-- The official MarathonMitra public events API (api.marathonmitra.com) gives
-- us banner images and organizer names — the race cards get a visual upgrade.
ALTER TABLE races
    ADD COLUMN image_url TEXT,
    ADD COLUMN organizer TEXT;

-- +goose Down
ALTER TABLE races
    DROP COLUMN organizer,
    DROP COLUMN image_url;
