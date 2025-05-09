document.addEventListener('DOMContentLoaded', function() {
    console.log('Socio.io dashboard loaded');
    
    // Example of dynamically updating content
    function updateApiStatus() {
        fetch('/api/status')
            .then(response => response.json())
            .then(data => {
                const statusBadge = document.querySelector('.status-badge');
                if (data.active) {
                    statusBadge.classList.remove('inactive');
                    statusBadge.classList.add('active');
                    statusBadge.textContent = 'Active';
                } else {
                    statusBadge.classList.remove('active');
                    statusBadge.classList.add('inactive');
                    statusBadge.textContent = 'Inactive';
                }
            })
            .catch(error => {
                console.error('Error checking API status:', error);
            });
    }
    
    // Update API status every 30 seconds
    setInterval(updateApiStatus, 30000);
    
    // Add event listener to any interactive elements
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach(card => {
        card.addEventListener('click', function() {
            // Example action when clicking on a stat card
            const statType = this.querySelector('h3').textContent;
            console.log(`Clicked on ${statType} card`);
        });
    });
});