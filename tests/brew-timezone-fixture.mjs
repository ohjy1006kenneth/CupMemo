import assert from 'node:assert/strict';
import console from 'node:console';
import { localToUTC } from '../apps/web/src/components/brew-draft.ts';
assert.equal(localToUTC('2026-03-08T02:30:00'), null); // nonexistent America/New_York local time
assert.equal(localToUTC('2026-11-01T01:30:00'), '2026-11-01T05:30:00.000Z'); // earlier native overlap
assert.equal(localToUTC('2026-03-08T03:30:00'), '2026-03-08T07:30:00.000Z');
console.log('Native timezone DST gap/earlier overlap/local UTC conversion passed.');
