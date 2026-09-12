// Only declared dataset/split pairs may be imported. Never fall back to another game.
export const truthCatalog = Object.freeze({
  'varsity-fixed-camera-240p.mp4': Object.freeze({
    train: 'varsity-ground-truth.json', validation: 'varsity-ground-truth-validation.json',
    test: 'varsity-ground-truth-test.json', audit: 'varsity-ground-truth-audit.json',
    audit2: 'varsity-ground-truth-audit-2.json'
  }),
  'varsity-randolph-240p.webm': Object.freeze({
    test: 'varsity-randolph-ground-truth-test.json', audit: 'varsity-randolph-ground-truth-audit.json',
    crossAudit: 'varsity-randolph-ground-truth-audit.json'
  }),
  'varsity-harwood-240p.webm': Object.freeze({ test: 'varsity-harwood-ground-truth-test.json' }),
  'varsity-test-proxy.webm': Object.freeze({ test: 'varsity-ground-truth-test-proxy.json' })
});

export function truthPathFor(video, split) {
  if (!Object.hasOwn(truthCatalog, video)) return null;
  const entries = truthCatalog[video];
  return Object.hasOwn(entries, split) ? `/courtvision/samples/${entries[split]}` : null;
}
