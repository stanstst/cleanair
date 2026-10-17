# New separate job to archive records from table air_quality

## Functional requirements
* add optional param --months to the job 36 is default
* records older than  --months param value should be archived and deleted
* use target_date air_quality.column to select records for archive
* put the selected records in a csv file named as target_date-archive.csv
* store the created file in the container in /tmp/archive directory
* do not add any metrics to Grafana
* log in the container stdout the name of the csv file 

## Code structure
* directory /archiver from the project root dir
* components 
* job.js 
* AirQualityRepository to get the  selected records
* ArchiveCreator creates the csv file
* FileUploader for the moment store the csv file in the container in /tmp/archive directory 
