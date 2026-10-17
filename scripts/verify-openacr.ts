import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import schema from '../data/openacr-0.1.0.schema.json' with { type: 'json' };
const value = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
if (!validate(value)) {
  console.error(validate.errors);
  process.exit(1);
}
console.log(
  'GSA OpenACR 0.1.0 schema validation passed. This does not establish evaluation completeness or conformance.',
);
