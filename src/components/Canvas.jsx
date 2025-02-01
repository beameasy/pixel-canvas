import { supabase } from '../lib/supabaseClient';

const Canvas = forwardRef(({ selectedColor, socket }, ref) => {
  // ... keep existing state and handlers ...

  const handleClick = async (e) => {
    if (!address) return;
    
    const coords = getGridCoordinates(e);
    if (!coords) return;
    const { x, y } = coords;

    try {
      // Place pixel
      const { error: pixelError } = await supabase
        .from('pixels')
        .upsert({
          x,
          y,
          color: selectedColor,
          placed_by: address
        });

      if (pixelError) throw pixelError;

      // Create terminal message
      const { error: messageError } = await supabase
        .from('terminal_messages')
        .insert({
          message: `placed a ${selectedColor} pixel at (${x}, ${y})`,
          wallet_address: address,
          message_type: 'pixel_placed'
        });

      if (messageError) throw messageError;

    } catch (error) {
      console.error('Error:', error);
      setFlashMessage({
        type: 'error',
        message: 'Failed to place pixel'
      });
    }
  };

  // Load initial pixels
  useEffect(() => {
    const loadPixels = async () => {
      const { data: pixels, error } = await supabase
        .from('pixels')
        .select('*');

      if (error) {
        console.error('Error loading pixels:', error);
        return;
      }

      pixels.forEach(pixel => {
        drawPixel(ctx, pixel.x, pixel.y, pixel.color);
      });
    };

    loadPixels();
  }, []);

  // Subscribe to pixel changes
  useEffect(() => {
    const subscription = supabase
      .channel('pixels')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'pixels' },
        (payload) => {
          const { x, y, color } = payload.new;
          drawPixel(ctx, x, y, color);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // ... keep rest of component the same ...
}); 