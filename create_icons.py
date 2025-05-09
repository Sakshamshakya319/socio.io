from PIL import Image, ImageDraw, ImageFont
import os

# Create directory if it doesn't exist
icons_dir = "extension/images"
os.makedirs(icons_dir, exist_ok=True)

# Define icon sizes
sizes = [16, 48, 128]

# Define colors
background_color = (66, 133, 244)  # Google Blue
text_color = (255, 255, 255)  # White

for size in sizes:
    # Create a new image with blue background
    img = Image.new('RGB', (size, size), background_color)
    draw = ImageDraw.Draw(img)
    
    # Add a simple 'S' in the center
    # For small icons, we'll just draw a circle
    if size < 32:
        # Draw a white circle in the center
        circle_radius = size // 4
        circle_position = (size // 2, size // 2)
        draw.ellipse(
            (
                circle_position[0] - circle_radius, 
                circle_position[1] - circle_radius,
                circle_position[0] + circle_radius, 
                circle_position[1] + circle_radius
            ), 
            fill=text_color
        )
    else:
        # Try to use a font
        try:
            # Calculate font size (roughly 60% of icon size)
            font_size = int(size * 0.6)
            
            # Try to find a system font
            try:
                font = ImageFont.truetype("arial.ttf", font_size)
            except:
                try:
                    font = ImageFont.truetype("Arial.ttf", font_size)
                except:
                    # Fall back to default font
                    font = ImageFont.load_default()
                    
            # Draw the letter 'S'
            text = "S"
            text_width, text_height = draw.textsize(text, font=font) if hasattr(draw, 'textsize') else font.getsize(text)
            text_position = ((size - text_width) // 2, (size - text_height) // 2)
            draw.text(text_position, text, fill=text_color, font=font)
            
        except Exception as e:
            print(f"Error creating text for size {size}: {e}")
            # If text fails, draw a simple circle
            circle_radius = size // 3
            circle_position = (size // 2, size // 2)
            draw.ellipse(
                (
                    circle_position[0] - circle_radius, 
                    circle_position[1] - circle_radius,
                    circle_position[0] + circle_radius, 
                    circle_position[1] + circle_radius
                ), 
                fill=text_color
            )
    
    # Save the icon
    img.save(f"{icons_dir}/icon{size}.png")
    print(f"Created icon{size}.png")

print("All icons created successfully!")