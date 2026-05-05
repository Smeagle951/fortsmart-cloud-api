import 'dotenv/config';
import { createApp } from './app.js';
const port = Number(process.env.PORT) || 3000;
const app = createApp();
app.listen(port, () => {
    console.log(`fortsmart-cloud-api listening on :${port}`);
});
//# sourceMappingURL=server.js.map