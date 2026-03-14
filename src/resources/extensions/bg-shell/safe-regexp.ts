/** Compile a user-supplied regex with basic catastrophic-backtracking guard. */
export function safeRegExp(pattern: string, flags?: string): RegExp {
	// Reject patterns with nested quantifiers that cause catastrophic backtracking
	if (/(\+|\*|\{)\s*(\+|\*|\{)/.test(pattern) || /\(\?[^)]*\(/.test(pattern)) {
		throw new Error(`Regex pattern rejected (potential ReDoS): ${pattern}`);
	}
	return new RegExp(pattern, flags);
}
