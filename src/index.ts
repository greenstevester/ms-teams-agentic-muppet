import express from 'express';
import {
  CloudAdapter,
  ConfigurationServiceClientCredentialFactory,
  createBotFrameworkAuthenticationFromConfiguration,
} from 'botbuilder';
import { MuppetBot } from './bot';

const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
  MicrosoftAppId: process.env.MS_APP_ID,
  MicrosoftAppPassword: process.env.MS_APP_PASSWORD,
  MicrosoftAppType: process.env.MS_APP_TYPE ?? 'MultiTenant',
  MicrosoftAppTenantId: process.env.MS_APP_TENANT_ID,
});

const auth = createBotFrameworkAuthenticationFromConfiguration(
  null,
  credentialsFactory,
);

export const adapter = new CloudAdapter(auth);

adapter.onTurnError = async (ctx, err) => {
  console.error('[turn-error]', err);
  try {
    await ctx.sendActivity('Something went wrong on my end. The error has been logged.');
  } catch (sendErr) {
    console.error('[turn-error] also failed to send fallback:', sendErr);
  }
};

const bot = new MuppetBot();
const app = express();
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/api/messages', (req, res) => {
  adapter.process(req, res, (ctx) => bot.run(ctx));
});

const PORT = Number(process.env.PORT ?? 3978);
app.listen(PORT, () => {
  console.log(`ms-teams-agentic-muppet listening on :${PORT}`);
});
