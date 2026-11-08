import { describe, expect, it } from 'vitest';

import {
  COACH_TRAITS,
  MINUTES_BAND80,
  PDROP_FEATURES,
  PDROP_MODEL,
  ROLE_FEATURES,
  ROLE_HEADS,
  ROS_ABS,
  ROS_MODEL,
  STAT_PROJ,
} from './roleModelConstants';

// Every number is compared with RoleModel.gs itself in roleModel.parity.test.ts (ROLE_MODEL_GS_DIR).
describe('role model constants', () => {
  it('has one coefficient per feature in every head', () => {
    expect(ROLE_FEATURES).toHaveLength(60);
    expect(new Set(ROLE_FEATURES).size).toBe(60);
    expect(Object.keys(ROLE_HEADS)).toHaveLength(7);
    for (const head of Object.values(ROLE_HEADS)) expect(head.coef).toHaveLength(60);
    expect(PDROP_FEATURES).toHaveLength(52);
    expect(PDROP_MODEL.coef).toHaveLength(52);
  });

  it('bands the minutes prediction in ascending order', () => {
    expect(MINUTES_BAND80).toHaveLength(5);
    const uptos = MINUTES_BAND80.map((band) => band.upto);
    expect(uptos).toEqual([...uptos].sort((a, b) => a - b));
  });

  it('keys coach traits by Statly team code, with zeros for a new coach', () => {
    expect(Object.keys(COACH_TRAITS)).toHaveLength(30);
    expect(COACH_TRAITS.NOP).toBeDefined();
    expect(COACH_TRAITS.PHX).toBeDefined();
    expect(COACH_TRAITS.NOR).toBeUndefined();
    expect(COACH_TRAITS.DAL).toEqual(['new coach', 0, 0, 0, 0, 0]);
  });

  it('has the projection coefficient shapes', () => {
    for (const coef of Object.values(STAT_PROJ)) expect(coef).toHaveLength(8);
    expect(ROS_MODEL.min).toHaveLength(11);
    expect(ROS_MODEL.avail).toHaveLength(11);
    expect(ROS_MODEL.pts).toHaveLength(7);
    expect(ROS_ABS).toHaveLength(6);
  });
});
