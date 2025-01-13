require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

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
app.use(cookieParser());
app.use(morgan('dev'));



app.get('/', (req, res) => {
    res.send('b10a12 server running..')
  })
  
app.listen(port, () => {
    console.log(`b10a12 running on port ${port}`)
  })
