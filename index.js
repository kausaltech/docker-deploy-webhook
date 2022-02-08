/**
 * A service for automated deployment from Docker Hub to Docker Swarm
 * https://docs.docker.com/docker-hub/webhooks/
 */
process.env.PORT = process.env.PORT || 3000

const fs = require('fs')
const express = require('express')
const bodyParser = require('body-parser')
const child_process = require('child_process')
const { IncomingWebhook } = require('@slack/webhook')

const app = express()
const services = require(`./config.json`)[process.env.CONFIG || 'production']

const dockerCommand = process.env.DOCKER || '/usr/bin/docker'
const token = process.env.TOKEN_FILE ? fs.readFileSync(process.env.TOKEN_FILE, 'utf-8').trim() : process.env.TOKEN || ''
const username = process.env.USERNAME || ''
const password = process.env.PASSWORD_FILE ? fs.readFileSync(process.env.PASSWORD_FILE, 'utf-8').trim() : process.env.PASSWORD || ''
const registry = process.env.REGISTRY || ''
const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || ''
const slackWebhook = slackWebhookUrl ? new IncomingWebhook(slackWebhookUrl) : null

if (!token || !username || !password)
  return console.error("Error: You must set a token, username and password.")

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

app.post('/', (req, res) => {
  const auth_header = req.header('authorization')
  if (!auth_header) {
    console.log("Webhook called without Authorization header.")
    return res.status(401).send('Authorization header missing\n').end()
  }
  if (!auth_header.startsWith('Bearer ')) {
    console.log("Webhook called with invalid authentication scheme (must be Bearer).")
    return res.status(401).send('Invalid authentication scheme\n').end()
  }
  const req_token = auth_header.slice(7)
  if (!req_token || req_token != token) {
    console.log("Webhook called with invalid token.")
    return res.status(401).send('Invalid token\n').end()
  }

  // Send response back right away if token was valid
  res.send('OK')

  const payload = req.body
  const image = `${payload.repository.repo_name}:${payload.push_data.tag}`

  if (!services[image]) return console.log(`Received updated for "${image}" but not configured to handle updates for this image.`)

  const service = services[image].service

  // Make sure we are logged in to be able to pull the image
  child_process.exec(`${dockerCommand} login -u "${username}" -p "${password}" ${registry}`,
    (error, stdout, stderr) => {
      if (error) {
        console.error(error)
        return
      }

      // Deploy the image and force a restart of the associated service
      console.log(`Deploying ${image} to ${service}...`)
      child_process.exec(`${dockerCommand} service update ${service} --force --with-registry-auth --image=${image}`,
        (error, stdout, stderr) => {
          if (error) {
            const message = `Failed to deploy ${image} to ${service}!`
            console.error(message)
            console.error(error)
            if (slackWebhook) {
              slackWebhook.send({
                text: message,
              })
            }
            return
          }

          const message = `Deployed ${image} to ${service} successfully and restarted the service.`
          console.log(message)
          if (slackWebhook) {
            slackWebhook.send({
              text: message,
            })
          }
        })
  })
})

app.all('*', (req, res) => {
  res.status(404).send('Not found\n')
})

app.listen(process.env.PORT, err => {
  if (err) throw err
  console.log(`Listening for webhooks on http://localhost:${process.env.PORT}`)
})
