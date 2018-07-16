#! /bin/bash

curl https://raw.githubusercontent.com/qiu8310/minapp/master/schema/app.json > ../data/app.json
curl https://raw.githubusercontent.com/qiu8310/minapp/master/schema/page.json > ../data/page.json
curl https://raw.githubusercontent.com/qiu8310/minapp/master/schema/component.json > ../data/component.json
curl https://schemastore.azurewebsites.net/api/json/catalog.json > ../src/extensions/json/catalog.json
