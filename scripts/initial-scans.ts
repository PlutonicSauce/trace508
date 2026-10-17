import { createAssessment } from '../packages/core/src/assessment';
import { db } from '../packages/core/src/db';
for (const variant of ['before', 'after'])
  console.log(
    await createAssessment({
      name: `W3C CityLights · ${variant === 'before' ? 'Before' : 'After'}`,
      url: `https://www.w3.org/WAI/demos/bad/${variant}/home.html`,
      pages: 4,
    }),
  );
await db.$disconnect();
