import config from "@adddog/eslint";

export default config({ vue: true }).overrideRules({
    "no-console": "off",
    "node/prefer-global/process": "off",
    "ts/no-explicit-any": "off",
    "ts/no-unused-vars": "off",
    "unused-imports/no-unused-vars": "off",
});
