require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
const corsOptions = {
  origin: ['http://localhost:5173'],
  credentials: true,
  optionSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

// JWT Verification Middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).send({ message: 'Unauthorized access. Token is missing.' });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: 'Forbidden. Invalid token.' });
    }
    req.user = decoded;
    next();
  });
};

// Admin Verification Middleware
const verifyAdmin = async (req, res, next) => {
  const email = req.user?.email;
  const query = { email };
  const result = await usersCollection.findOne(query);
  if (!result || result?.role !== 'admin') {
    return res.status(403).send({ message: 'Forbidden Access! Admin Only Actions!' });
  }

  next();
};

// Generate JWT token
app.post('/jwt', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).send({ message: 'Email is required.' });
  }

  const token = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: '7d',
  });

  res.send({ success: true, token });
});

// Logout Route
app.get('/logout', (req, res) => {
  res.send({ message: 'Logged out successfully' });
});

// Protected Route Example
app.get('/protected', verifyToken, (req, res) => {
  res.send({ message: 'This is a protected route.', user: req.user });
});

// Admin Only Route Example
app.get('/admin-only', verifyToken, verifyAdmin, (req, res) => {
  res.send({ message: 'This is an admin-only route.' });
});

// Database Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.2a8vu.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log('Pinged your deployment. Successfully connected to MongoDB!');

    const usersCollection = client.db('ProtikshaNews').collection('users');

    app.post('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = req.body;

      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }

      const result = await usersCollection.insertOne({
        ...user,
        role: 'viewer',
        timestamp: Date.now(),
      });
      res.send(result);
    });
  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Server running...');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
