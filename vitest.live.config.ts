import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/live/**/*.live.test.ts'],
		environment: 'node',
		setupFiles: ['test/unit/setup.ts'],
		testTimeout: 300_000,
		fileParallelism: false,
	},
});
