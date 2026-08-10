select
    event_type,
    event_category,
    is_billable
from {{ ref('stg_event_types') }}
