import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/live/**/*.live.test.ts'],
		environment: 'node',
		testTimeout: 300_000,
		fileParallelism: false,
	},
});
