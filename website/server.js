// This file is no longer needed as we've integrated the payment routes into app.js
// Keeping it for reference

const express = require('express');
const app = express();
const cors = require('cors');
const router = require('./routes/payments.routes');
const port = 4000;

app.use(express.json());
app.use(cors());

app.use('/api', router);

app.get('/', (req, res) => {
    res.send("Hello World");
});

// Only start this server if not running through app.js
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });
}