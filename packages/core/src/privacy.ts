/** Keep execution inputs in protected journey records, not in routine report/package metadata. */
export function redactConfiguration(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const data = JSON.parse(JSON.stringify(value));
  if (data.journey?.steps)
    data.journey.steps = data.journey.steps.map((step: Record<string, unknown>) => ({
      ...step,
      ...('value' in step ? { value: '[redacted execution input]' } : {}),
    }));
  return data;
}
