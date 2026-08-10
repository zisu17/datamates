select
    event_date,
    event_type,
    count(*)                 as event_count,
    count(distinct user_id)  as user_count,
    sum(amount)              as total_amount
from {{ ref('fct_events') }}
group by
    event_date,
    event_type
