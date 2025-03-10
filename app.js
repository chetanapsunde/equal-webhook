// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import express from 'express';
import { pinoHttp, logger } from './utils/logging.js';
import APIrouter from './routes.js';
const app = express();
app.use(express.json())
// Use request-based logger for log correlation
app.use((req, res, next) => {
  logger.info(req.body);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, PUT, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
})
app.use(pinoHttp);
app.use("/", APIrouter);

export default app;
