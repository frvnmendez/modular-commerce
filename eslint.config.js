import tseslint from 'typescript-eslint';

/** Reglas de seguridad propias: el contexto de tenant solo se fija en @mc/db (withStore/withUser). */
const tenantContextRules = {
  'no-restricted-syntax': ['error',
    { selector: "Literal[value=/set_config\\s*\\(\\s*'app\\./i]", message: 'Usa withStore/withUser de @mc/db; no fijes app.* a mano.' },
    { selector: "TemplateElement[value.raw=/set_config\\s*\\(\\s*'app\\./i]", message: 'Usa withStore/withUser de @mc/db; no fijes app.* a mano.' },
    { selector: "Literal[value=/\\bSET\\s+(SESSION\\s+)?app\\./i]", message: 'Prohibido SET de sesión sobre app.*' },
    { selector: "Literal[value=/\\bSET\\s+(LOCAL\\s+)?ROLE\\b/i]", message: 'Prohibido cambiar de rol desde la aplicación.' },
  ],
};

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/*.config.*', 'docs/**', 'poc/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      ...tenantContextRules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Único lugar autorizado a fijar el contexto: el paquete de acceso a datos.
  { files: ['packages/db/src/**'], rules: { 'no-restricted-syntax': 'off' } },
  // Los tests de sabotaje modifican la BD deliberadamente.
  { files: ['tests/**', '**/test/**'], rules: { 'no-restricted-syntax': 'off', '@typescript-eslint/no-explicit-any': 'off' } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', process: 'readonly', console: 'readonly', setTimeout: 'readonly', URL: 'readonly', document: 'readonly', window: 'readonly' } }, rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
