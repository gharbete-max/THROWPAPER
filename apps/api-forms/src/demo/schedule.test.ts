import { describe, expect, it } from 'vitest';
import { registrationOpen } from '../events/service.js';
import { demoEventName, demoSchedule } from './schedule.js';
import type { EventRecord } from '../db/repositories/index.js';

/**
 * The seed used to pin `2026-05-14`, which meant that from `2026-05-08` onwards the demo could not
 * accept a registration — and said nothing about it. These tests exist so that cannot recur.
 */
describe('the demo schedule', () => {
  it('is always in the future, whenever it is asked', () => {
    for (const today of ['2026-01-01', '2026-09-01', '2031-12-25']) {
      const now = new Date(`${today}T12:00:00Z`);
      const schedule = demoSchedule(now);
      expect(schedule.startsAt.getTime()).toBeGreaterThan(now.getTime());
      expect(schedule.endsAt.getTime()).toBeGreaterThan(schedule.startsAt.getTime());
    }
  });

  it('leaves registration open today', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const schedule = demoSchedule(now);
    expect(schedule.registrationClosesAt.getTime()).toBeGreaterThan(now.getTime());
    expect(schedule.registrationClosesAt.getTime()).toBeLessThan(schedule.startsAt.getTime());
  });

  /** The assertion that would have caught the original bug. */
  it('produces an event a visitor can actually register for', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const schedule = demoSchedule(now);

    const event: EventRecord = {
      id: 'e1',
      organisationId: 'o1',
      name: demoEventName(schedule),
      description: {},
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt,
      venueName: null,
      venueAddress: null,
      capacity: 250,
      registrationClosesAt: schedule.registrationClosesAt,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };

    // 200 seeded registrations against a capacity of 250 must still leave room.
    expect(registrationOpen(event, 200, now)).toBe(true);
  });

  it('names the event for the year it falls in, so the title cannot go stale either', () => {
    expect(demoEventName(demoSchedule(new Date('2031-11-15T00:00:00Z')))['en-GB']).toBe(
      'Spring meeting 2032',
    );
  });
});
