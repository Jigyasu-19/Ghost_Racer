/**
 * Unit 3 verification: demonstrate contracts schemas
 * validating and rejecting sample payloads.
 *
 * Run: npx tsx packages/contracts/src/verify.ts
 */
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  PublicUserSchema,
  ApiErrorSchema,
} from './index.js';

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

console.log('\n── Contracts Schema Verification ──\n');

// RegisterRequest — valid
test('RegisterRequest accepts valid payload', () => {
  const result = RegisterRequestSchema.safeParse({
    username: 'PlayerOne',
    email: 'player@example.com',
    password: 'securepass123',
  });
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
});

// RegisterRequest — rejects short password
test('RegisterRequest rejects short password', () => {
  const result = RegisterRequestSchema.safeParse({
    username: 'PlayerOne',
    email: 'player@example.com',
    password: 'short',
  });
  if (result.success) throw new Error('Should have rejected short password');
});

// RegisterRequest — rejects invalid username
test('RegisterRequest rejects username starting with number', () => {
  const result = RegisterRequestSchema.safeParse({
    username: '1badname',
    email: 'player@example.com',
    password: 'securepass123',
  });
  if (result.success) throw new Error('Should have rejected invalid username');
});

// RegisterRequest — email is normalized to lowercase
test('RegisterRequest normalizes email to lowercase', () => {
  const result = RegisterRequestSchema.safeParse({
    username: 'PlayerOne',
    email: 'UPPER@CASE.COM',
    password: 'securepass123',
  });
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  if (result.data.email !== 'upper@case.com')
    throw new Error(`Expected lowercase email, got: ${result.data.email}`);
});

// LoginRequest — valid
test('LoginRequest accepts valid payload', () => {
  const result = LoginRequestSchema.safeParse({
    identity: 'PlayerOne',
    password: 'securepass123',
  });
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
});

// LoginRequest — rejects empty identity
test('LoginRequest rejects empty identity', () => {
  const result = LoginRequestSchema.safeParse({
    identity: '',
    password: 'securepass123',
  });
  if (result.success) throw new Error('Should have rejected empty identity');
});

// PublicUser — valid
test('PublicUser accepts valid shape', () => {
  const result = PublicUserSchema.safeParse({
    id: 'abc123',
    username: 'PlayerOne',
    role: 'player',
    tutorialCompleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
});

// PublicUser — rejects invalid role
test('PublicUser rejects invalid role', () => {
  const result = PublicUserSchema.safeParse({
    id: 'abc123',
    username: 'PlayerOne',
    role: 'superadmin',
    tutorialCompleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  if (result.success) throw new Error('Should have rejected invalid role');
});

// ApiError — valid
test('ApiError accepts valid envelope', () => {
  const result = ApiErrorSchema.safeParse({
    error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
  });
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
});

console.log('\n── Done ──\n');
