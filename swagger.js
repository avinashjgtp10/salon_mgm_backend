const swaggerAutogen = require('swagger-autogen')();

const doc = {
  info: {
    title: 'SalonoX API',
    description: 'SalonoX Backend API Documentation',
    version: '1.0.0'
  },
  host: 'dev.salonox.com',
  schemes: ['https'],
  securityDefinitions: {
    bearerAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description: 'Enter: Bearer <token>'
    }
  }
};

const outputFile = './docs/api/swagger-gen.json';
const routes = ['./src/app.ts'];

swaggerAutogen(outputFile, routes, doc);