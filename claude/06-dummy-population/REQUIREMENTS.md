# make a script that populates air_quality with dummy records

## Requirements

* do not call any external api
* it should take parameters date_from 
* date_to is now, the time of execution
* for each target_date insert 3 records for city sofia ruse varna
* fill records for every target_date between date_from and now
* use the condition on duplicate unique_key omit insert

### Use the rules for Field values

* city  = sofia or ruse or varna
* target_date date between start_date param and now date
* 
* mean_ratio from 0.3 to 3.3
* max_ratio from 0.3 to 3.3
* 
* pm25_average from 5 to 15
* pm25_unit = µg/m³
* pm25_ratio from 0.3 to 3.3
* 
* pm10_average from 5 to 15
* pm10_unit = µg/m³
* pm10_ratio from 0.3 to 3.3
* 
* co_average from 5 to 15
* co_unit = µg/m³
* co_ratio from 0.3 to 3.3

