import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/unit/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['test/unit/setup.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/core/**', 'src/translator/**', 'src/services/**'],
			reporter: ['text', 'html', 'lcov'],
		},
	},
});
