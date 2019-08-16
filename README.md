# alexa-skill-pco
An Alexa Skill for interacting with (https://planning.center/)[Planning Center], an online software platform for churches.

### How to Run / Deploy

This Alexa Skill contains a skill manifest JSON file along with the source for a Node.js Lambda function which is used 
by the skill to communicate with the PCO Services API. Both the skill as well as the corresponding Lambda function are 
deployed using the [ASK CLI](https://developer.amazon.com/docs/smapi/quick-start-alexa-skills-kit-command-line-interface.html). 

#### To compile and run the project:

0. You need an [AWS account](https://aws.amazon.com) and an [Amazon developer account](https://developer.amazon.com) to 
create an Alexa Skill.

1. You need to install and configure the [AWS CLI](https://aws.amazon.com/cli/). See https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html
for information about configuring AWS CLI.

```bash
$ pip install aws-cli
$ aws configure 
```

2. Then install and initialize [ASK CLI](https://developer.amazon.com/docs/smapi/quick-start-alexa-skills-kit-command-line-interface.html)

```bash
$ ask init
```

3. You need to install the NodeJS dependencies...

```bash
$ cd lambda/src
$ npm install
```

#### Lambda / DynamoDB permissions:

After deploying, you will need to add DynamoDB permission to the IAM Role created to execute your function :

- Connect to AWS Console : https://console.aws.amazon.com/iam/home?region=us-east-1#/roles
- Select the role created to execute your lambda function (it is named "ask-lambda-Planning-Center" if you did not change the default name)
- Click "Attach Policy"
- Locate and select "DynamoDBFullAccessPolicy" role and click "Attach Policy"