require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { ObjectId } = require('mongodb'); 
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)

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
    const subscriptionsCollection = client.db('ProtikshaNews').collection('subscriptions');

    // Schedule the cron job to run every hour
    cron.schedule('0 * * * *', async () => {
      try {
        const currentTime = new Date();
        console.log(`Cron job started at ${currentTime.toISOString()}`);
    
        // Find and update expired subscriptions
        const expiredUsers = await usersCollection.updateMany(
          {
            role: 'premium',
            subscriptionExpiry: { $lte: currentTime }
          },
          {
            $set: { role: 'viewer' }, // Update role to viewer
            $unset: { subscriptionExpiry: '' } // Optionally remove the subscriptionExpiry field
          }
        );
    
        console.log(`${expiredUsers.modifiedCount} subscriptions expired and reverted.`);
      } catch (error) {
        console.error('Error cleaning expired subscriptions:', error);
        // Optional: Send an alert (e.g., email or logging service)
        // sendErrorAlert(error); // Add your alerting function here
      }
    });
    


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

    // Premium User Role Verification Middleware
    const verifyPremiumUserOrAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
    
      try {
        const user = await usersCollection.findOne(query);
    
        const currentTime = new Date();
        const isPremiumUser = user?.role === 'premium' && user?.subscriptionExpiry > currentTime;
        const isAdmin = user?.role === 'admin';
    
        if (!isPremiumUser && !isAdmin) {
          // If subscription expired, revert user to normal role
          if (user?.role === 'premium' && user?.subscriptionExpiry <= currentTime) {
            await usersCollection.updateOne({ email }, { $set: { role: 'viewer' }, $unset: { subscriptionExpiry: "" } });
          }
          return res.status(403).send({ message: 'Forbidden access' });
        }
        next();
      } catch (error) {
        console.error('Error verifying premium user or admin:', error);
        res.status(500).send({ message: 'Internal Server Error' });
      }
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
        const { id } = req.params; 

        try {
            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) }, 
                { $set: { role: "admin" } } 
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
        });
        res.send(result);
      });

      // delete article by ID
      app.delete('/delete-article/:id', verifyToken, async (req, res) => {
        const articleId = req.params.id;
        const query = { _id: new ObjectId(articleId) }; // Assuming ObjectId is used for MongoDB IDs
        const result = await articlesReqCollection.deleteOne(query);
        
        if (result.deletedCount === 1) {
          res.send({ message: 'Article deleted successfully' });
        } else {
          res.status(404).send({ message: 'Article not found' });
        }
      });


    //  all articles 
      app.get('/articles-req', async (req, res) => {
        const { searchTerm } = req.query;  
        
        try {
       
          const query = searchTerm
            ? { title: { $regex: searchTerm, $options: 'i' } }  
            : {};  
          
          const result = await articlesReqCollection.find(query).toArray();
          res.send(result);
        } catch (error) {
          console.error('Error fetching article requests:', error);
          res.status(500).send({ message: 'Error fetching article requests' });
        }
      });

      app.get('/premium-articles', async (req, res) => {
        try {
          // Define the query for fetching premium articles
          const query = { isPremium: true };
      
          const result = await articlesReqCollection.find(query).toArray();
          res.send(result);
        } catch (error) {
          console.error('Error fetching premium articles:', error);
          res.status(500).send({ message: 'Error fetching premium articles' });
        }
      });
      

      //get single articles
      app.get('/articles-req/:id', async (req, res) => {
        const id = req.params.id
        const query = { _id: new ObjectId(id) }
        const result = await articlesReqCollection.findOne(query)
        res.send(result);
    })

    app.put('/articles-req/update/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedArticleData = req.body; 
  
      
      const query = { _id: new ObjectId(id) };
      const options = { upsert: false }; 
  
      
      const updateDoc = {
          $set: {
              title: updatedArticleData.title,
              description: updatedArticleData.content,  
              photoURL: updatedArticleData.image,  
              authorName: updatedArticleData.authorName,
              authorEmail: updatedArticleData.authorEmail,
              status: updatedArticleData.status,
              postedDate: updatedArticleData.postedDate,
              views: updatedArticleData.views,
          }
      };
  
      try {
          const result = await articlesReqCollection.updateOne(query, updateDoc, options);
  
          // If no document was updated (could be due to no changes or invalid ID)
          if (result.modifiedCount === 0) {
              return res.status(404).send({ message: "Article not found or no changes made" });
          }
  
          // Successfully updated
          res.send({ message: "Article updated successfully", result });
      } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to update article", error });
      }
  });
  
  

    // Get articles by user's email
    app.get('/my-articles/:email', verifyToken, async (req, res) => {
      const email = req.params.email; // Extract email from request parameters
      const query = { email: email }; // Query for matching the email field
      try {
        const result = await articlesReqCollection.find(query).toArray(); // Find all matching documents
        res.send(result); // Send the resulting articles to the client
      } catch (error) {
        console.error('Error fetching articles by email:', error); // Log any errors for debugging
        res.status(500).send({ message: 'Internal Server Error', error }); // Send a server error response
      }
    });


    // articles view count related api
    app.put('/articles-req/view/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      try {
          const result = await articlesReqCollection.updateOne(
              query,
              { $inc: { viewCount: 1 } } 
          );
          
          if (result.modifiedCount > 0) {
              res.send({ message: 'View count updated successfully!' });
          } else {
              res.status(404).send({ message: 'Article not found!' });
          }
      } catch (error) {
          res.status(500).send({ message: 'Error updating view count', error });
      }
    });


    // trending article related api
    app.get('/trending-articles', async (req, res) => {
      try {
          const result = await articlesReqCollection
              .find()
              .sort({ viewCount: -1 })  // Sort by view count in descending order
              .limit(6)  // Limit to 6 articles
              .toArray();
          res.send(result);
      } catch (error) {
          res.status(500).send({ message: 'Error fetching trending articles', error });
      }
    });


    

  // article approve
  app.patch('/articles-req/approve/:id', verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: {
        status: 'Approved', // Update status field to 'Approved'
        approved: true // If you want to maintain the approved field as well
      }
    };
    const result = await articlesReqCollection.updateOne(filter, updatedDoc);
    res.send(result); // Ensure the result is sent back
  });

    // reject article
    app.patch('/articles-req/reject/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { reason } = req.body; // Get the reason from the request body
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
          $set: {
              status: 'Rejected', // Update status to 'Rejected'
              approved: false,
              rejectReason: reason, // Save the rejection reason
          },
      };
      const result = await articlesReqCollection.updateOne(filter, updatedDoc);
      res.send(result);
  });

  // article make premium
app.patch('/articles-req/premium/:id', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const filter = { _id: new ObjectId(id) };
  const updatedDoc = {
      $set: {
          isPremium: true, 
      },
  };
  const result = await articlesReqCollection.updateOne(filter, updatedDoc);
  res.send(result); 
});
  
  // create payment intent
  app.post('/create-payment-intent', verifyToken, async (req, res) => {
    const { price } = req.body;
    const amount = parseInt(price * 100);
    console.log(amount,'amount intent')

    const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
    })
    res.send({
        clientSecret: paymentIntent.client_secret
    })
})

// subscriptions related API
app.post('/subscriptions', verifyToken, async (req, res) => {
  try {
    const { subscriptionPeriod, subscriptionCost, paymentIntentId } = req.body;

    if (!subscriptionPeriod || !subscriptionCost || !paymentIntentId) {
      return res.status(400).send({ success: false, message: 'Missing required fields' });
    }

    // Verify payment intent status (Stripe logic)
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (stripeError) {
      return res.status(400).send({ success: false, message: 'Invalid payment intent ID' });
    }

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).send({ success: false, message: `Payment failed: ${paymentIntent.status}` });
    }

    const { email } = req.decoded;

    let subscriptionExpiry = new Date();
    switch (subscriptionPeriod) {
      case '1min':
        subscriptionExpiry.setSeconds(subscriptionExpiry.getSeconds() + 30); // 30 seconds
        break;
      case '1':
        subscriptionExpiry.setDate(subscriptionExpiry.getDate() + 1);
        break;
      case '5':
        subscriptionExpiry.setDate(subscriptionExpiry.getDate() + 5);
        break;
      case '10':
        subscriptionExpiry.setDate(subscriptionExpiry.getDate() + 10);
        break;
      default:
        return res.status(400).send({ success: false, message: 'Invalid subscription period' });
    }

    // Update user's subscription status to premium if valid
    const updateResult = await usersCollection.updateOne(
      { email },
      { $set: { role: 'premium', subscriptionExpiry } }
    );

    res.status(201).send({
      success: true,
      message: 'Subscription saved successfully',
      subscriptionExpiry,
      updateResult,
    });
  } catch (error) {
    console.error('Error saving subscription:', error);
    res.status(500).send({
      success: false,
      message: 'Failed to save subscription',
      error: error.message,
    });
  }
});





// update premium to viwer
app.post('/users/:email', async (req, res) => {
  const email = req.params.email;
  const query = { email };
  const user = req.body;

  const isExist = await usersCollection.findOne(query);

  // If the user exists, check if the subscription is expired and update role to 'viewer'
  if (isExist) {
    const currentSubscriptionExpiry = isExist.subscriptionExpiry;

    if (currentSubscriptionExpiry && new Date(currentSubscriptionExpiry) <= new Date()) {
      // Subscription expired, update role to 'viewer'
      await usersCollection.updateOne(
        { email },
        { $set: { role: 'viewer', subscriptionExpiry: null } }
      );
    }
    return res.send(isExist);  // Send back the existing user data (now with 'viewer' role if expired)
  }

  // If user doesn't exist, create a new user with 'viewer' role
  const result = await usersCollection.insertOne({
    ...user,
    role: 'viewer',
    timestamp: new Date(),
  });
  res.send(result);
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
        timestamp: new Date(),
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
    
      const currentDate = new Date();
      const subscriptionExpiry = new Date(user.subscriptionExpiry);
    
      // Check if the subscription has expired and update the role to 'viewer'
      if (subscriptionExpiry && subscriptionExpiry <= currentDate) {
        // Subscription expired, update role to 'viewer' and reset subscriptionExpiry
        await usersCollection.updateOne(
          { email },
          { $set: { role: 'viewer', subscriptionExpiry: null } }
        );
        // Update the user object after role change
        user.role = 'viewer';
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

    // Update user profile
    app.put('/users/:email', async (req, res) => {
      const email = req.params.email;
      const updateData = req.body;
    
      if (!email || !updateData) {
        return res.status(400).send({ message: "Invalid request" });
      }
    
      const filter = { email };
      const updateDoc = { $set: updateData };
    
      try {
        const result = await usersCollection.updateOne(filter, updateDoc);
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send({ success: true, message: "Profile updated successfully" });
      } catch (error) {
        console.error('Error updating profile:', error); // Log the error for debugging
        res.status(500).send({ error: "Failed to update profile" });
      }
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
