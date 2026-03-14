import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts", "packages/**/*.ts"],
		rules: {
			// Warn on explicit any — track reduction over time
			"@typescript-eslint/no-explicit-any": "warn",
			// Warn on unused vars (many pre-existing) — prefixed with _ are OK
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
					ignoreRestSiblings: true,
				},
			],
			// Allow empty catch blocks (many are intentional, annotated)
			"@typescript-eslint/no-empty-function": "off",
			"no-empty": ["warn", { allowEmptyCatch: true }],
			// Allow require() in specific patterns (postinstall, scripts)
			"@typescript-eslint/no-require-imports": "off",
			// Noise for this codebase — pre-existing issues
			"no-useless-escape": "warn",
			"no-regex-spaces": "warn",
			"no-useless-assignment": "warn",
			"prefer-const": "warn",
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-unsafe-function-type": "warn",
			"no-control-regex": "warn",
			// Pre-existing: many re-thrown errors lack cause
			"preserve-caught-error": "warn",
		},
	},
	{
		ignores: [
			"dist/**",
			"pkg/**",
			"node_modules/**",
			"packages/*/dist/**",
			"packages/*/node_modules/**",
			"native/**",
			"**/*.js",
			"**/*.cjs",
			"**/*.mjs",
		],
	},
);
