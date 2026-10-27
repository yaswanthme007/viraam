import { createGateway } from './app';

const PORT = Number(process.env.PORT ?? 4000);
const { app, policy } = createGateway();

app.listen(PORT, () => {
  console.log(`VIRAAM gateway on http://localhost:${PORT}`);
  console.log(`  policy "${policy.name}" v${policy.version}: ${policy.rules.length} rules, default ${policy.default}`);
  console.log('  payment rail: MOCK (in-memory, no network)');
});
