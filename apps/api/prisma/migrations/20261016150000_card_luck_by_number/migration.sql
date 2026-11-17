-- D-128: a card's luck bonus = the tier's bonus + 1% per pattern point of its number, up to 50%
-- (the defaults of cardLuck and tiers at the time of this change). It used to count the tier's own
-- rarity points too, so every Legendary and Mythic hit the cap whatever its number.
UPDATE "cards" SET "luck_bonus_bp" =
  CASE "tier"
    WHEN 'common' THEN 0 WHEN 'rare' THEN 300 WHEN 'epic' THEN 600
    WHEN 'legendary' THEN 1000 WHEN 'mythic' THEN 1500
  END
  + LEAST(
      GREATEST("rarity_score" - CASE "tier"
        WHEN 'common' THEN 1 WHEN 'rare' THEN 3 WHEN 'epic' THEN 8
        WHEN 'legendary' THEN 25 WHEN 'mythic' THEN 80
      END, 0) * 100,
      5000
    );
