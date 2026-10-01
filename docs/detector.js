(function() {
	//#region browser-extension/src/engine/detector.ts
	var RULES = [
		{
			categoryId: "government_id",
			maskLabel: "주민등록번호",
			pattern: /(?<!\d)\d{6}[- ]?[1-8]\d{6}(?!\d)/
		},
		{
			categoryId: "phone_number",
			maskLabel: "전화번호",
			pattern: /(?<!\d)0(?:2|[3-6]\d|1[016789]|70|50[2-8])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/
		},
		{
			categoryId: "api_key",
			maskLabel: "API 키/토큰",
			pattern: /(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|github_pat_[A-Za-z0-9_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})(?![A-Za-z0-9])/
		},
		{
			categoryId: "email",
			maskLabel: "이메일",
			pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z])/
		}
	];
	function normalizeForDetection(text) {
		try {
			return typeof text.normalize === "function" ? text.normalize("NFKC") : text;
		} catch {
			return text;
		}
	}
	function selectRules(options) {
		const disabled = options && Array.isArray(options.disabledCategories) ? options.disabledCategories : [];
		if (disabled.length === 0) return RULES;
		const skip = new Set(disabled);
		return RULES.filter((rule) => !skip.has(rule.categoryId));
	}
	function findMatches(text, options) {
		if (typeof text !== "string" || text.length === 0) return [];
		const found = [];
		for (const rule of selectRules(options)) {
			const pattern = new RegExp(rule.pattern.source, "g");
			let hit = pattern.exec(text);
			while (hit !== null) {
				found.push({
					categoryId: rule.categoryId,
					label: rule.maskLabel,
					start: hit.index,
					end: hit.index + hit[0].length
				});
				if (hit[0].length === 0) pattern.lastIndex += 1;
				hit = pattern.exec(text);
			}
		}
		found.sort((a, b) => a.start - b.start || a.end - b.end);
		const accepted = [];
		let lastEnd = 0;
		for (const match of found) {
			if (match.start < lastEnd) continue;
			accepted.push(match);
			lastEnd = match.end;
		}
		return accepted;
	}
	function applyMatches(text, matches) {
		if (typeof text !== "string") return "";
		if (!Array.isArray(matches) || matches.length === 0) return text;
		let result = "";
		let cursor = 0;
		for (const match of matches) {
			result += text.slice(cursor, match.start) + `[${match.label}]`;
			cursor = match.end;
		}
		return result + text.slice(cursor);
	}
	function inspect(text, options) {
		const source = typeof text === "string" ? normalizeForDetection(text) : "";
		return selectRules(options).filter((rule) => rule.pattern.test(source)).map((rule) => rule.categoryId);
	}
	function mask(text, options) {
		const rules = selectRules(options);
		const source = typeof text === "string" ? text : "";
		const normalized = typeof text === "string" ? normalizeForDetection(text) : "";
		let masked = source;
		for (const rule of rules) {
			const pattern = new RegExp(rule.pattern.source, "g");
			masked = masked.replace(pattern, () => `[${rule.maskLabel}]`);
		}
		if (normalized !== source) {
			let normalizedMasked = normalized;
			for (const rule of rules) normalizedMasked = normalizedMasked.replace(new RegExp(rule.pattern.source, "g"), () => `[${rule.maskLabel}]`);
			if (normalizedMasked !== normalized && masked === source) masked = normalizedMasked;
		}
		return masked;
	}
	var detector = Object.freeze({
		inspect,
		findMatches,
		applyMatches,
		mask
	});
	//#endregion
	//#region browser-extension/src/entries/detector.ts
	globalThis.AIInputGatewayDetector = detector;
	//#endregion
})();
