require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { ObjectId } = require('mongodb'); // Import ObjectId for MongoDB

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
    const publishersCollection = client.db('ProtikshaNews').collection('publishers');
    const articlesReqCollection = client.db('ProtikshaNews').collection('articles');

    // JWT Verification Middleware
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'forbidden access' });
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: 'forbidden access' });
        }
        req.decoded = decoded;
        next();
      });
    };

    // Admin Verification Middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next();
    };

    // Publishers
    app.post('/publishers', verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await publishersCollection.insertOne(item);
      if (result.acknowledged) {
        res.send({ success: true, message: 'Publisher added successfully' });
      } else {
        res.status(500).send({ message: 'Error adding publisher' });
      }
    });



    // Update user role to "admin"
    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
        const { id } = req.params; // Extract user ID from params

        try {
            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) }, // Find user by _id
                { $set: { role: "admin" } } // Set role to "admin"
            );

            if (result.modifiedCount > 0) {
                res.send({ message: "User role updated to admin.", modifiedCount: result.modifiedCount });
            } else {
                res.status(404).send({ message: "User not found or role already set." });
            }
        } catch (error) {
            console.error("Error updating user role:", error);
            res.status(500).send({ message: "Failed to update user role.", error });
        }
    });


     // articles req post
      app.post('/articles-req', verifyToken, async (req, res) => {
        const articlesReqData = req.body;
        const result = await articlesReqCollection.insertOne({
          ...articlesReqData,
          approved: false, // Add an 'approved' field with a default value of false
        });
        res.send(result);
      });


     // article request get
app.get('/articles-req', verifyToken, async (req, res) => {
  try {
    const result = await articlesReqCollection.find().toArray();
    res.send(result);
  } catch (error) {
    console.error('Error fetching article requests:', error);
    res.status(500).send({ message: 'Error fetching article requests' });
  }
});


      // article aprove
      app.patch('/approve-article/:id', verifyToken, async (req, res) => {
        const { id } = req.params;
        const { isApproved } = req.body; // 'isApproved' will be passed as true or false
    
        if (isApproved === undefined) {
            return res.status(400).send({ message: 'Approval status is required.' });
        }
    
        const result = await articlesReqCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { approved: isApproved } }
        );
    
        if (result.modifiedCount > 0) {
            res.send({ message: 'Article approval status updated.' });
        } else {
            res.status(404).send({ message: 'Article not found.' });
        }
    });
    
      
  

    // Get All Publishers
    app.get('/publishers', async (req, res) => {
      try {
        const publishers = await publishersCollection.find().toArray();
        res.send(publishers);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching publishers', error });
      }
    });


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

    // Save user in DB
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

    // Update User Role (Admin Only)
    app.patch('/users/role/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;

      if (!role) {
        return res.status(400).send({ message: 'Role is required.' });
      }

      const result = await usersCollection.updateOne(
        { email },
        { $set: { role } }
      );

      if (result.modifiedCount === 0) {
        return res.status(404).send({ message: 'User not found or role already set.' });
      }

      res.send({ message: 'Role updated successfully.' });
    });

    // Get User Role
    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user) {
        return res.status(404).send({ message: 'User not found.' });
      }

      res.send({ role: user.role });
    });

    // Get All Users
    app.get('/users', async (req, res) => {
      const { search } = req.query;
      const query = search
        ? {
            $or: [
              { name: { $regex: search, $options: 'i' } },
              { email: { $regex: search, $options: 'i' } },
            ],
          }
        : {};

      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // Get User By Email
    app.get('/users/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
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
