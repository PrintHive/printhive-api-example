import { z } from 'zod';
const value = z.union([z.string().nullable(), z.array(z.string()), z.number(), z.boolean()]);
export const engineReviewSchema = z.object({
  changes: z.array(z.object({ key: z.string().min(1), sourceValue: value, engineValue: value, slots: z.array(z.number().int().min(1).max(64)).max(64) }).strict()).min(1).max(1000).refine(changes => new Set(changes.map(change => change.key)).size === changes.length),
  sourceRelease: z.string().nullable(), engineRelease: z.string().min(1),
}).strict();
const heldReviewSchema = z.object({ code: z.literal('project_review_required'), changes: engineReviewSchema.shape.changes, sourceRelease: z.string().nullable(), engineRelease: z.string().min(1) });
const actionSchema = z.union([heldReviewSchema, z.object({ hold: heldReviewSchema }).transform(action => action.hold)]);
export function engineReviewFor(actions) {
  for (const action of actions) {
    const parsed = actionSchema.safeParse(action);
    if (parsed.success) {
      const { changes, sourceRelease, engineRelease } = parsed.data;
      return { changes, sourceRelease, engineRelease };
    }
  }
  return null;
}
