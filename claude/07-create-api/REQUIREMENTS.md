# Create Api and UI

## Create http Api endpoint GET cleanest-city?date-from=2025-10-06&date-to=2026-10-06
* put tha api service in separate dir api
* params date-from, date-to
* response payload must include city, period_mean_polution

### Rules for selecting the result
* use this query example to select data from table air_quality in CityRepository class to select records

```SQL

select city, avg(max_ratio) as period_max_polution, avg(mean_ratio) as period_mean_polution
from air_quality
where target_date > '2022-10-06' and target_date < '2025-10-06'

group by city
order by avg(max_ratio) , avg(mean_ratio) 
limit 1;

```
* return the record in payload format {record1}
* do not change data the record in the app code

## Create a simple UI web page that uses Api endpoint GET cleanest-city?date-from=2025-10-06&date-to=2026-10-06
* add a simple clean calendar date picker from ready library for date-from and date-to query params
* use simple and well known and well used calendar picker library
* show the response in one row: 
* Cleanest City by overall pollution load is : city with period_max_polution and period_mean_polution
* UI web page: localhost:port-number