-- +goose Up

-- Badge catalog + level ladder move from CODE to the DATABASE, so thresholds
-- are tunable in production with a single UPDATE/INSERT — no deploy. The MVP
-- plan is launch → watch real runners → recalibrate.
--
-- A badges row is a RULE: `metric` names the verified stat the evaluator
-- computes (from activities/attendance/challenges — nothing hand-claimable),
-- `target` is the bar (current >= target ⇒ award). The parameterized
-- `pace_run` metric also reads arg_distance_m + arg_pace_s: "a run of at
-- least X meters at under Y seconds per km". Retire a badge with active=false
-- (history stays); tiers are display accents (1 bronze, 2 silver, 3 gold).
CREATE TABLE badges (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    emoji          TEXT NOT NULL DEFAULT '🏅',
    description    TEXT NOT NULL DEFAULT '',
    category       TEXT NOT NULL CHECK (category IN ('distance','single','streak','consistency','pace','time','club','challenge')),
    tier           INT  NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 3),
    xp             INT  NOT NULL DEFAULT 0,
    target         DOUBLE PRECISION NOT NULL CHECK (target > 0),
    unit           TEXT NOT NULL DEFAULT '',
    metric         TEXT NOT NULL,
    arg_distance_m DOUBLE PRECISION,  -- pace_run: minimum run distance
    arg_pace_s     DOUBLE PRECISION,  -- pace_run: pace bar, seconds per km
    sort_order     INT  NOT NULL DEFAULT 0,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE levels (
    title TEXT PRIMARY KEY,
    at_xp INT  NOT NULL UNIQUE CHECK (at_xp >= 0)
);

-- XP ≈ 10/km + 25/run-day + badge bonuses: a serious 100 km/week club runner
-- earns ~70k over a committed year; a casual 20 km/week runner ~15-20k. Club
-- Legend = a full committed year even for the strongest (the old in-code
-- ceiling of 16k fell in ~3 months for them).
INSERT INTO levels (title, at_xp) VALUES
    ('Rookie', 0),
    ('Jogger', 500),
    ('Pacer', 2000),
    ('Front Runner', 6000),
    ('Podium Hunter', 15000),
    ('Club Elite', 30000),
    ('Club Legend', 60000);

-- Seed: recalibrated for real club runners (the serious ones cover 100-140
-- km/WEEK — the old ceiling emptied the wall in weeks). Floors stay low as
-- early hooks; ceilings are multi-season goals.
INSERT INTO badges (id, name, emoji, description, category, tier, xp, target, unit, metric, arg_distance_m, arg_pace_s, sort_order) VALUES
    -- Firsts
    ('first_run',      'First Stride',       '👟',  'Record your first GPS run',                'club',        1,   50, 1,     'run',       'total_runs',   NULL, NULL, 10),
    ('first_club',     'Found My Crew',      '🤝',  'Join your first club',                     'club',        1,   50, 1,     'club',      'clubs',        NULL, NULL, 20),
    -- Lifetime distance (top rung ≈ 1.5-2 committed years at 100 km/week)
    ('km_100',         '100 km Club',        '🥉',  'Run 100 km all-time',                      'distance',    1,  200, 100,   'km',        'total_km',     NULL, NULL, 30),
    ('km_500',         '500 km Club',        '🥈',  'Run 500 km all-time',                      'distance',    2,  400, 500,   'km',        'total_km',     NULL, NULL, 40),
    ('km_1000',        '1000 km Club',       '🥇',  'Run 1000 km all-time',                     'distance',    2,  800, 1000,  'km',        'total_km',     NULL, NULL, 50),
    ('km_2500',        '2500 km Beast',      '🦁',  'Run 2500 km all-time',                     'distance',    3, 1200, 2500,  'km',        'total_km',     NULL, NULL, 60),
    ('km_5000',        '5000 km Machine',    '🏆',  'Run 5000 km all-time',                     'distance',    3, 2000, 5000,  'km',        'total_km',     NULL, NULL, 70),
    ('km_10000',       '10,000 km Immortal', '🌏',  'Run 10,000 km all-time',                   'distance',    3, 4000, 10000, 'km',        'total_km',     NULL, NULL, 80),
    -- Single-run distance (event-anchored milestones)
    ('run_5k',         '5K Finisher',        '🎽',  'Run 5 km in one go',                       'single',      1,  100, 5,     'km',        'max_run_km',   NULL, NULL, 90),
    ('run_10k',        '10K Finisher',       '🏅',  'Run 10 km in one go',                      'single',      1,  150, 10,    'km',        'max_run_km',   NULL, NULL, 100),
    ('run_half',       'Half Marathoner',    '🦾',  'Run 21.1 km in one go',                    'single',      2,  300, 21.1,  'km',        'max_run_km',   NULL, NULL, 110),
    ('run_full',       'Marathoner',         '🌟',  'Run 42.2 km in one go',                    'single',      3,  600, 42.2,  'km',        'max_run_km',   NULL, NULL, 120),
    ('run_50k',        'Ultra Runner',       '🏔️', 'Run 50 km in one go',                      'single',      3,  800, 50,    'km',        'max_run_km',   NULL, NULL, 130),
    -- Streaks (100 days is elite territory)
    ('streak_3',       'Warming Up',         '✨',  'Run 3 days in a row',                      'streak',      1,   75, 3,     'days',      'best_streak',  NULL, NULL, 140),
    ('streak_7',       'On Fire',            '🔥',  'Run 7 days in a row',                      'streak',      1,  150, 7,     'days',      'best_streak',  NULL, NULL, 150),
    ('streak_14',      'Unstoppable',        '⚡',  'Run 14 days in a row',                     'streak',      2,  250, 14,    'days',      'best_streak',  NULL, NULL, 160),
    ('streak_30',      'Iron Will',          '🛡️', 'Run 30 days in a row',                     'streak',      2,  500, 30,    'days',      'best_streak',  NULL, NULL, 170),
    ('streak_60',      'Relentless',         '🔱',  'Run 60 days in a row',                     'streak',      3,  900, 60,    'days',      'best_streak',  NULL, NULL, 180),
    ('streak_100',     'Century Streak',     '💯',  'Run 100 days in a row',                    'streak',      3, 1600, 100,   'days',      'best_streak',  NULL, NULL, 190),
    -- Consistency (rewards rhythm, not volume)
    ('consistent_4w',  'Metronome',          '🎯',  '3+ run days a week, 4 weeks straight',     'consistency', 2,  300, 4,     'weeks',     'best_weeks',   NULL, NULL, 200),
    ('consistent_12w', 'Clockwork',          '⏱️', '3+ run days a week, 12 weeks straight',    'consistency', 3,  800, 12,    'weeks',     'best_weeks',   NULL, NULL, 210),
    -- Pace ladder (everyday → club-racer). arg = min distance m, pace bar s/km
    ('pace_5k_30',     'Sub-30 5K',          '💨',  'Run 5 km at under 6:00/km pace',           'pace',        1,  150, 1,     'run',       'pace_run',     5000,    360,   220),
    ('pace_5k_25',     'Sub-25 5K',          '🌪️', 'Run 5 km at under 5:00/km pace',           'pace',        2,  350, 1,     'run',       'pace_run',     5000,    300,   230),
    ('pace_10k_60',    'Sub-60 10K',         '🚀',  'Run 10 km at under 6:00/km pace',          'pace',        2,  250, 1,     'run',       'pace_run',     10000,   360,   240),
    ('pace_10k_50',    'Sub-50 10K',         '☄️', 'Run 10 km at under 5:00/km pace',          'pace',        3,  500, 1,     'run',       'pace_run',     10000,   300,   250),
    ('pace_half_2h',   'Sub-2 Half',         '🎖️', 'Run a half marathon under 2 hours',        'pace',        3,  600, 1,     'run',       'pace_run',     21097.5, 341.3, 260),
    -- Time-of-day personality
    ('early_bird',     'Early Bird',         '🌅',  '10 runs started before 6 AM',              'time',        1,  200, 10,    'runs',      'early_runs',   NULL, NULL, 270),
    ('night_owl',      'Night Owl',          '🦉',  '10 runs started after 9 PM',               'time',        1,  200, 10,    'runs',      'night_runs',   NULL, NULL, 280),
    ('weekend_20',     'Weekend Warrior',    '🗓️', 'Run on 20 weekend days',                   'time',        2,  300, 20,    'days',      'weekend_days', NULL, NULL, 290),
    ('monsoon_10',     'Monsoon Runner',     '🌧️', '10 runs in monsoon months (Jun–Sep)',      'time',        2,  200, 10,    'runs',      'monsoon_runs', NULL, NULL, 300),
    -- Club life
    ('attend_10',      'Regular',            '📍',  'Check in at 10 club runs',                 'club',        2,  250, 10,    'check-ins', 'attendance',   NULL, NULL, 310),
    ('attend_25',      'Club Pillar',        '🏛️', 'Check in at 25 club runs',                 'club',        3,  500, 25,    'check-ins', 'attendance',   NULL, NULL, 320),
    -- Challenge arc
    ('challenge_join',   'Challenger',       '🚩',  'Join your first challenge',                'challenge',   1,   75, 1,     'challenge', 'ch_joined',    NULL, NULL, 330),
    ('challenge_done',   'Goal Getter',      '✅',  'Complete a challenge goal',                'challenge',   2,  150, 1,     'challenge', 'ch_done',      NULL, NULL, 340),
    ('challenge_done_5', 'Serial Finisher',  '🎖️', 'Complete 5 challenge goals',               'challenge',   3,  400, 5,     'challenges','ch_done',      NULL, NULL, 350),
    ('challenge_podium', 'Podium Finish',    '🥉',  'Finish top 3 in a challenge',              'challenge',   2,  300, 1,     'podium',    'ch_podium',    NULL, NULL, 360),
    ('challenge_win',    'Champion',         '👑',  'Win a challenge outright',                 'challenge',   3,  500, 1,     'win',       'ch_won',       NULL, NULL, 370);

-- Recalibration cleanup: km_25/weekend_12 are retired; early_bird/night_owl
-- bars were raised (5 → 10 runs), so earned rows are purged to re-earn at the
-- new bar. Pre-launch, user base is tiny — this is the one moment a clean
-- rescale is possible.
DELETE FROM user_badges WHERE badge_id IN ('km_25', 'weekend_12', 'early_bird', 'night_owl');

-- +goose Down
DROP TABLE IF EXISTS badges;
DROP TABLE IF EXISTS levels;
